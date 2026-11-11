import mongoose from 'mongoose';

export interface User {
  name: string;
  email: string;
  password?: string | undefined;
  isEmailVerified: boolean;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new mongoose.Schema<User>({
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 100,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: 254,
  },
  password: {
    type: String,
    required: true,
    select: false,
  },
  isEmailVerified: {
    type: Boolean,
    required: true,
    default: false,
  },
  emailVerifiedAt: {
    type: Date,
    default: null,
  },
},{
    timestamps: true,
    versionKey: false,
});

const UserModel = mongoose.model<User>('User', userSchema);

export default UserModel;
