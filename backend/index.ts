import express from "express"
import cors from "cors"
import authController from "./controller/auth.controller";

const app = express();
app.use(cors);
app.use(express.json());

app.get("/api/v1/auth",authController);

app.get("")



export default app;
