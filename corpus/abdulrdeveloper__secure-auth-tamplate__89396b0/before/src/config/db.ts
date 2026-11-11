import mongoose from "mongoose";
import 'dotenv/config';

const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is not defined in the environment variables");
    }
    const connection = await mongoose.connect(process.env.MONGO_URI as string);
    console.log(`MongoDB Connected`);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
};

export default connectDB;