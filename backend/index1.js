const express = require("express");
const app = express();
const cors = require("cors");

//middleware
app.use(express.json());
app.use(cors())

app.get("/", (req,res) => {
    res.send("Api running");
});
const port = 5000;

app.get("/api/user",(req,res)=> {
    res.json({
    name: "Thembinkosi",
    email: "sutfusiza@gmail.com",
    password: 76211582,
    school: "Emagobodvo high school"
    })
})

app.get("/api/posts",(req,res)=> {
    res.json({
        username: "siza",
        post: "i live coding and making music"
    })
})
app.listen(port,()=>{
    console.log(`server is running on port ${port}`)
});