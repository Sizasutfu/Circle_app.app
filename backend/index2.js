const express = require("express");
//const { version } = require("react");
const app = express("");
const port = 5000;


//middleware
app.use(express.json());

//cors
//allow request from React frontend

app.use((req,res,next) => {
    res.setHeader("access-Control-allow-Origin", "*");
    res.setHeader("access-control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("access-Control-Allow-Headers", "Content-Type");
    next()
});

let users = [
    {
        id: 1,
        name: "Siza mndzawe",
        email: "alice@example.com",
        password: "Password123",
        createdAt: new Date("2026-03-07"),
    },
    {   id: 2,
        name: "siza mndzawe",
        email: "sizasutfu@gmail.com",
        password: "12345678",
        createdAt: new Date("2026-03-07"),
    }    
];

let posts = [
    {
        id: 1,
        userId: 1,
        author: "Siza Mndzawe",
        text: "welcome to circle! Excited to be here",
        image: null,
        likes: [2],
        comments: [
            {
                id: 1,
                userId: 2,
                author: "Bob Smith",
                text: "welcome Alice! Greate to have you",
                createdAt: new Date("2026-03-07")     
            },
             {
                id: 1,
                userId: 2,
                author: "Bob Smith",
                text: "welcome Alice! Greate to have you",
                createdAt: new Date("2026-03-07")     
            }
        ], 
        createdAt: new Date("2026-03-07"),
    },
     {
        id: 2,
        userId: 2,
        author: "siza mndzawe",
        text: "Just posted my first photo on Circle!",
        image: null,
        likes: [2],
        comments: [
            {
                id: 1,
                userId: 2,
                author: "Bob Smith",
                text: "welcome Alice! Greate to have you",
                createdAt: new Date("2026-03-07")     
            }
        ], 
        createdAt: new Date("2026-03-07"),
    },

];

//counters for generating unique IDs

let nextUserId = users.length + 1;
let nextPostId = posts.length + 1;
let nextComentId = 100;

 //send a consistent JSON response every time.

 const sendResponse = (res, statusCode, success, message, data = null) => {
    const response = ({ success, message});
    if (data !== null) response.data = data;

    return res.status(statusCode).json(response);
 };
  //POST /api/users/register
  //create a new account
 app.post("/api/users/register", (req, res) => {
    const { name, email, password} = req.body;

 
 //make sure all fields are present
 if (!name || !email || !password) {
    return sendResponse(res, 400, false, "Name, email, and password are required.");
 }

 //check if email is already taken

 const existingUser = users.find((u) => u.email === email);
 if(existingUser){
    return sendResponse(res, 409, false, "A user with that email address already exist");
 }
 //---create the new user object----
 
 const newUser = {
    id: nextUserId++,
    name,
    email,
    password,
    createdAt: new Date(),
 };

 users.push(newUser);//save user to our  in-memory array


 //return success
 const { password: _, ...userWithoutpassword} = newUser;
 return sendResponse(res, 201, true, "user registered sucessfully", userWithoutpassword);
});

app.post("/api/users/login", (req, res) => {
    const { email, password } = req.body;

    //validation
    if (!email || !password) {
        return sendResponse(res, 400, false, "Email and password are required");
    
    }

    //find the user by email
    const user = users.find((u) => u.email === email)
    if (!user) {
        return sendResponse(res, 400, false, "No account found with that email");
    }

    //check the password

    if (user.password !== password) {
        return sendResponse(res, 400, false, "incorrect password");
    }

    //Return the user 
     
    const { password_, ...userWithoutpassword} = user;
    return sendResponse(res, 200, true, "Login success", userWithoutpassword)


}),

//Return all post

app.get("/api/posts", (req,res) => {
    const sorted = [...posts].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sendResponse(res, 200, true, "post fetched succefully.", sorted)
});

//create a new post

app.post("/api/posts", (req, res) => {
    const { userId, text, image } = req.body;


    if (!userId) {
        return sendResponse(res, 400, false, "userId is required.");

    }

    if (!text && !image){
        return sendResponse(res, 400, false, "A post must have text or an image");
    };
     //verify the user exits

     const user = users.find((u) => u.id === userId);
     if (!user) {
        return sendResponse(res, 400, false, "User not found");
     }

     //build the new post

     const newPost = {
        id: nextPostId++,
        userId,
        author: user.name,
        text: text || "",
        image: image || null,
        likes: [],
        comments: [],
        createdAt: new Date(),
     };

     posts.push(newPost);
     return sendResponse(res, 201, true, "post created successfully.", newPost);
});

//delete a post by it's Id

app.delete("/api/posts/:id", (req, res) =>{

    //req.params.id comes from the URL as a string - convert it to a number
    const postId = parseInt(req.params.id);

    //find the index of the post in our array
    const index = posts.findIndex((p) => p.id === postId);
    if (index === -1) {
        return sendResponse(res, 404, false, "post not found");
    }

    const deleted = posts.splice(index, 1)[0];
    return sendResponse(res, 200, true, "post deleted successfully");



});

app.post("/api/posts/:id/comment", (req, res) => {
    const postId = parseInt(req.params.id);
    const { userId, text} = req.body;
 
    //validation
    if (!userId || !text) {
        return sendResponse(res, 400, false, "userId and text are required");
    }

    //find the post
    const post = posts.find((p) => p.id === postId);
    if (!post) {
        return sendResponse(res, 404, false, "post not found")
    }
    
    //find the comment

    const user = users.find((u) => u.id === userId);
    if (!users) {
         return sendResponse(res, 404, false, "user not found");
    }

    //build and attact the comment----

    const newComment = {
        id: nextComentId++,
        userId,
        author: user.name,
        text,
        createdAt: new Date(),
    };

    post.comments.push(newComment);
    return sendResponse(res, 201, true, "comment added successfully", newComment);

});

    app.post("/api/posts/:id/like",(req,res) => {
        const postId = parseInt(req.params.id);
        const { userId } = req.body;

        //validation
        if (!userId) {
            return sendResponse(res, 400, false, "useId not found");

        }

        //find the post

        const post = posts.find((p) => p.id === postId);
        if (!post) {
            return sendResponse(res, 404, false, "post not found");

        }

        //verify user exist

        const user = users.find((u) => u.id === userId);

        if (!user) {
            return sendResponse(res, 404, "user not found");

        }

        //toogle the like button

        const alreadyliked = post.likes.includes(userId);
        
        if (alreadyliked) {
            //remove the like
            post.likes = post.likes.filter((id) => id !== userId);
            sendResponse(res, 200, true, "post unliked", { likes: post.likes.length});

        } else {
            //add the like
            post.likes.push(userId);
            return sendResponse(res,200, true, "post liked", { likes: post.likes.length });
        }
    });
     //simple check to know th server is running
    app.get("/" ,(req, res) => {
        res.json({
            message: "welcome to circle api",
            version: "1.0.0",
            endpoints: {
                users: ["POST /api/users/register", 
                    "POST /api/users/login"
                ],
                posts: ["GET /api/posts", 
                    "POST /api/posts",
                    "DELETE /api/posts/:id"
                ],
                comments: ["POST /api/post/:id/comment"],
                likes: ["POST /api/posts/:id/like"]
                   
                
            }
        })
    })


 



app.listen(port, ()=> {
    console.log(`circle api is running on http://locahost:${port}`);
    console.log(`visit http:localhost:${port} to see all avaliable routes`);
})