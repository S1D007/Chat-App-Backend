const { Server } = require("socket.io");
const express = require("express")
const http = require("http")
const cors = require("cors")
const PORT = 3000;
const bodyParser = require('body-parser')
const mongoose = require("mongoose")
const app = express()
const jwt = require("jsonwebtoken");

const server = http.createServer(app)

app.use(cors())
app.use(bodyParser.json())

const io = new Server(server)

// Connection to M<ongoDB
const url = "mongodb://127.0.0.1:27017/chat-app"
const connectToDatabase = () => {
    mongoose
        .connect(url)
        .then(() => {
            console.log("Connection Succesfull");
        })
        .catch((e) => {
            console.log(`Error Occured Because > \n 
        ${e.message}
        `);
        });
};

connectToDatabase()

// Creatng the User Model
const User = mongoose.model("User", {
    username: {
        type: String,
        unique: true,
        required: true,
    },
    password: {
        type: String,
        min: 6,
        max: 12,
        required: true,
    },
    chats: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Chat"
    }]
})
// Creatng the Messsage Model
const Message = mongoose.model("Message", {
    message: String,
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"

    },
    timestamp: String,
})

// Creatng the Chat Model
const Chat = mongoose.model("Chat", {
    name: String,
    isGroupChat: Boolean,
    members: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }],
    messages: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Message"
    }],
})

io.on("connection", (socket) => {
    socket.on('joinRoom', (room, username) => {
        // console.log(`${username} joined ${room}`)
        socket.join(room);
    });

    socket.on("message", async ({ user_id, chat_id, message, username }) => {
        socket.to(chat_id).emit("message", {
            user_id,
            message,
            username,
            timestamp: new Date().toString()
        })
        const msg = new Message({
            message,
            user: user_id,
            timestamp: new Date().toString()
        })
        await msg.save()
        const chat = await Chat.findById(chat_id)
        chat.messages.push(msg)
        await chat.save()
    })
})

const OK = (res, message) => {
    return res.status(200).json({
        status: "OK",
        message
    })
}

const NotOk = (res, message, status = 500) => {
    return res.status(status).json({
        status: "ERROR",
        message
    })
}

const SECRET = "123321"

// Generate a JWT token
const generateToken = (userId) => {
    return jwt.sign({ userId }, SECRET, { expiresIn: "30d" });
};

// Verify the JWT token
const verifyToken = (token) => {
    return jwt.verify(token, SECRET);
};

// Middleware
const authenticateJWT = (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) {
        return NotOk(res, "Unauthorized", 401)
    }
    try {
        const _token = token.split(" ")[1];
        const decodedToken = verifyToken(_token);
        if (!decodedToken) {
            return NotOk(res, "Unauthorized", 401)
        }
        req.user = decodedToken;
        next();
    } catch (e) {
        return NotOk(res, "Unauthorized", 401)
    }
};

app.post("/user/signup", async (req, res) => {
    try {
        const { username, password } = req.body
        const user = new User({
            username,
            password
        })
        await user.save()
        const token = generateToken(user._id);
        // sendCookie(res, token)
        const JsonValWithoutPass = user.toJSON()
        delete JsonValWithoutPass.password
        JsonValWithoutPass.token = token
        return OK(res, JsonValWithoutPass, token)
    } catch (e) {
        return NotOk(res, e.message)
    }
})

app.post("/user/signin", async (req, res) => {
    try {
        const { username, password } = req.body
        const user = await User.findOne({
            username,
            password
        })
        if (!user) {
            return NotOk(res, "User not found")
        }
        const token = generateToken(user._id);
        const JsonValWithoutPass = user.toJSON()
        delete JsonValWithoutPass.password
        JsonValWithoutPass.token = token
        return OK(res, JsonValWithoutPass)
    } catch (e) {
        return NotOk(res, e.message)
    }
})

app.get('/available-users', authenticateJWT, async (req, res) => {
    try {
        const users = await User.find({}).select("-password")
        const usersWithoutMe = users.filter(user => user._id.toString() !== req.user.userId)
        return OK(res, usersWithoutMe)
    } catch (e) {
        return NotOk(res, e.message)
    }
})

app.get("/users", authenticateJWT, async (req, res) => {
    try {
        const userId = req.user.userId;
        const currentUser = await User.findById(userId).populate("chats");
        const allUsers = await User.find({ _id: { $ne: userId } }).select("-password");

        const usersNotInChatList = allUsers.filter(user => {
            return !currentUser.chats.some(chat => chat.members.some(member => member.toString() === user._id.toString()));
        });

        return OK(res, usersNotInChatList);
    } catch (e) {
        console.log(e);
        return NotOk(res, e.message);
    }
});

app.get("/profile", authenticateJWT, async (req, res) => {
    try {
        const userId = req.user.userId
        const user = await User.findById(userId).select("-password -chats")
        if (!user) {
            return NotOk(res, "User not found")
        }
        return OK(res, user)
    } catch (e) {
        return NotOk(res, e.message)
    }
})

app.post("/create-chat-individual", authenticateJWT, async (req, res) => {
    try {
        const { members } = req.body;
        const chat = new Chat({
            members
        });
        await chat.save();
        members.forEach(async member => {
            const user = await User.findById(member);
            user.chats.push(chat._id);
            await user.save();
        });
        const currChat = await Chat.findById(chat._id).populate("members").populate({
            path: "messages",
            populate: {
                path: "user",
                select: "-password"
            }
        })
        return OK(res, currChat);
    } catch (e) {
        return NotOk(res, e.message);
    }
});



app.post("/create-chat-group", authenticateJWT, async (req, res) => {
    try {
        const { members, name } = req.body
        console.log(req.body)
        const chat = new Chat({
            members,
            name,
            isGroupChat: true
        })
        await chat.save()
        members.forEach(async member => {
            const user = await User.findById(member)
            user.chats.push(chat._id)
            await user.save()
        })
        const currChat = await Chat.findById(chat._id).populate("members").populate({
            path: "messages",
            populate: {
                path: "user",
                select: "-password"
            }
        })
        return OK(res, currChat)
    } catch (e) {
        return NotOk(res, e.message)
    }
})

app.get('/chats', authenticateJWT, async (req, res) => {
    const userId = req.user.userId;
    try {
        const chats = await Chat.find({ members: userId }).populate("members").populate({
            path: "messages",
            populate: {
                path: "user",
                select: "-password"
            }
        });

        const filteredChats = chats.map(chat => {
            const filteredMembers = chat.members.filter(member => member._id.toString() !== userId);
            return { ...chat.toObject(), members: filteredMembers };
        });
        console.log(filteredChats)

        return OK(res, filteredChats);
    } catch (e) {
        return NotOk(res, e.message);
    }
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`)
})