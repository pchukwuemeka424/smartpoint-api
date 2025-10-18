const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ message: 'Access denied. No token provided.' });
        }
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password');
        
        if (!user || !user.isActive) {
            return res.status(401).json({ message: 'Invalid token or user not found.' });
        }
        
        req.user = user;
        
        // Update device activity if deviceId is provided
        const deviceId = req.header('X-Device-ID');
        if (deviceId) {
            await user.updateDeviceActivity(deviceId);
        }
        
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ message: 'Invalid token.' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token expired.' });
        }
        
        console.error('Auth middleware error:', error);
        res.status(500).json({ message: 'Server error during authentication.' });
    }
};

module.exports = auth;
