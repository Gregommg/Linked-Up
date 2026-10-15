const mongoose = require('mongoose');
const { Schema } = mongoose;

const User = mongoose.model('User', new Schema({
  username: { type: String, unique: true, required: true, lowercase: true, trim: true },
  email: { type: String, unique: true, required: true, lowercase: true, trim: true },
  passHash: { type: String, required: true }
}, { timestamps: true }));

const fs = new Schema({
  requester: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'accepted'], default: 'pending' }
}, { timestamps: true });
fs.index({ requester: 1, recipient: 1 }, { unique: true });
const Friendship = mongoose.model('Friendship', fs);

module.exports = { User, Friendship };
