import mongoose from "mongoose"


// add user interface of mongoDB also
const userSchema = new mongoose.Schema({
    name:String,
    userId:mongoose.types.ObjectId,
    OrganisationId:String,
    email:String,
    password:String,
    avatar:String,
    memberTag:String,
    isVerified:Boolean
})

const organisationSchema = new mongoose.Schema({
    id:String,
    name:String,
    email:String,
    // department_type:[include...],
    employeeId:mongoose.Schema.ObjectId
})

const conversationSchema = new mongoose.Schema({
    name:String,
    id: mongoose.types.ObjectId,
    messages:[],
})

// id will be generated randomly with time and need to store in the db