const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

// Load models before server starts
require('./models/User');
require('./models/Item');
require('./models/Sale');
require('./models/Transaction');
require('./models/Customer');

// Set default JWT secret if not provided
if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'your-super-secret-jwt-key-here-change-this-in-production';
    console.warn('WARNING: Using default JWT_SECRET. Please set JWT_SECRET environment variable for production!');
}

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://your-production-domain.com'] 
        : ['http://localhost:3000', 'http://192.168.1.243:3000', 'http://localhost:8081', 'http://192.168.1.243:8081'], // Allow specific origins in development
    credentials: true
}));

// Rate limiting removed for development

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// MongoDB connection with change streams support
const connectDB = async () => {
    try {
        // Use environment variable or default to local MongoDB
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/smartpos';
        
        // Mongoose 7+ defaults - suppress index warnings
        mongoose.set('strictQuery', false);
        
        const conn = await mongoose.connect(mongoUri);
        
        console.log(`MongoDB Connected: ${conn.connection.host}`);
        
        // Sync indexes to remove duplicates
        console.log('Synchronizing database indexes...');
        await syncIndexes();
        console.log('Database indexes synchronized successfully');
        
    } catch (error) {
        console.error('Database connection error:', error);
        console.log('Make sure MongoDB is running on your system');
        console.log('You can start MongoDB with: brew services start mongodb-community (on macOS)');
        process.exit(1);
    }
};

// Function to sync indexes and remove duplicates
const syncIndexes = async () => {
    try {
        const models = mongoose.modelNames();
        for (const modelName of models) {
            const model = mongoose.model(modelName);
            try {
                // This will drop indexes that are not in the schema and recreate missing ones
                await model.syncIndexes();
                console.log(`Indexes synced for ${modelName}`);
            } catch (error) {
                console.warn(`Warning: Could not sync indexes for ${modelName}:`, error.message);
            }
        }
    } catch (error) {
        console.warn('Warning: Index synchronization failed:', error.message);
    }
};

// Initialize database connection for serverless
let isConnected = false;

const connectToDatabase = async () => {
    if (isConnected && mongoose.connection.readyState === 1) {
        console.log('Using existing database connection');
        return { success: true, message: 'Using existing connection' };
    }
    
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/smartpos';
        mongoose.set('strictQuery', false);
        
        console.log('Attempting to connect to MongoDB...');
        const result = await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        
        isConnected = true;
        console.log('MongoDB Connected:', mongoose.connection.host);
        
        // Sync indexes
        await syncIndexes();
        
        return { success: true, message: 'Connected successfully', host: mongoose.connection.host };
    } catch (error) {
        console.error('Database connection error:', error);
        isConnected = false;
        return { success: false, message: error.message, stack: error.stack };
    }
};

// Middleware to ensure database connection before handling requests
app.use(async (req, res, next) => {
    if (!isConnected || mongoose.connection.readyState !== 1) {
        await connectToDatabase();
    }
    next();
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/items', require('./routes/items'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/finance', require('./routes/finance'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/cashiers', require('./routes/cashiers'));
app.use('/api/customers', require('./routes/customers'));

// Health check endpoint
app.get('/health', async (req, res) => {
    const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        mongodb: mongoStatus,
        environment: process.env.NODE_ENV || 'development'
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err.message : {}
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ message: 'Route not found' });
});

// For local development
if (process.env.NODE_ENV !== 'production') {
    connectDB().then(() => {
        app.listen(PORT, () => {
            console.log(`SmartPOS Server running on port ${PORT}`);
            console.log(`Environment: ${process.env.NODE_ENV}`);
            console.log(`Health check: http://localhost:${PORT}/health`);
        });
    });
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
        console.log('SIGTERM received, shutting down gracefully');
        mongoose.connection.close(() => {
            console.log('MongoDB connection closed');
            process.exit(0);
        });
    });
}

// Export for Vercel serverless
module.exports = app;
