import{useEffect,useState} from "react";

function App(){
  const[name,setName] = useState("");
   const[email,setEmail] = useState("");
   const[password,setPassword] = useState("")
   const[school,setschool] = useState("")
  
  useEffect(()=>{
    fetch("http://localhost:5000/api/user")
    .then(res => res.json())
    .then(data=> {
      setName(data.name)
      setEmail(data.email)
      setPassword(data.password)
      setschool(data.school)
    })
    
    
  },[]);


return(
  <div>
    <h1>Name: {name}</h1>
    <h1>Email: {email}</h1>
    <h1>Password: {password}</h1>
    <h1>School: {school}</h1>
  </div>
);
}

export default App;