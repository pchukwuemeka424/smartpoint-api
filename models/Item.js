const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200
    },
    price: {
        type: Number,
        required: true,
        min: 0
    },
    cost: {
        type: Number,
        min: 0,
        default: 0
    },
    category: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    brand: {
        type: String,
        trim: true,
        maxlength: 100
    },
    size: {
        type: String,
        trim: true,
        maxlength: 50
    },
    expiryDate: {
        type: Date
    },
    barcode: {
        type: String,
        trim: true,
        maxlength: 50
    },
    sku: {
        type: String,
        trim: true,
        maxlength: 50,
        unique: true,
        sparse: true
    },
    stock: {
        type: Number,
        default: 0,
        min: 0
    },
    minStock: {
        type: Number,
        default: 0,
        min: 0
    },
    image: {
        type: String, // URL or path to image
        trim: true
    },
    aiExtracted: {
        type: Boolean,
        default: false
    },
    aiConfidence: {
        type: Number,
        min: 0,
        max: 1
    },
    extractedData: {
        rawText: String,
        confidence: Number,
        boundingBoxes: [{
            text: String,
            bbox: {
                x0: Number,
                y0: Number,
                x1: Number,
                y1: Number
            },
            confidence: Number
        }]
    },
    isActive: {
        type: Boolean,
        default: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    managerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    cashierId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: function() {
            return this.userId && this.userId.toString() !== this.managerId.toString();
        }
    },
    deviceId: {
        type: String,
        required: true
    },
    lastSynced: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes for better query performance
itemSchema.index({ userId: 1, isActive: 1 });
itemSchema.index({ managerId: 1, isActive: 1 });
itemSchema.index({ cashierId: 1, isActive: 1 });
itemSchema.index({ name: 'text', brand: 'text' });
itemSchema.index({ category: 1 });
itemSchema.index({ barcode: 1 });
// Note: sku index is automatically created by unique: true and sparse: true
itemSchema.index({ lastSynced: 1 });

// Virtual for low stock warning
itemSchema.virtual('isLowStock').get(function() {
    return this.stock <= this.minStock;
});

// Pre-save middleware
itemSchema.pre('save', function(next) {
    this.lastSynced = new Date();
    next();
});

// Static methods
itemSchema.statics.findByUser = function(userId) {
    return this.find({ userId, isActive: true }).sort({ createdAt: -1 });
};

itemSchema.statics.findByManager = function(managerId, limit = 50) {
    return this.find({ 
        managerId, 
        isActive: true 
    }).sort({ createdAt: -1 }).limit(limit);
};

itemSchema.statics.findByCashier = function(cashierId, limit = 50) {
    return this.find({ 
        cashierId, 
        isActive: true 
    }).sort({ createdAt: -1 }).limit(limit);
};

itemSchema.statics.findLowStock = function(userId) {
    return this.find({ 
        userId, 
        isActive: true,
        $expr: { $lte: ['$stock', '$minStock'] }
    });
};

itemSchema.statics.findLowStockByManager = function(managerId) {
    return this.find({ 
        managerId, 
        isActive: true,
        $expr: { $lte: ['$stock', '$minStock'] }
    });
};

itemSchema.statics.searchItems = function(userId, query) {
    return this.find({
        userId,
        isActive: true,
        $or: [
            { name: { $regex: query, $options: 'i' } },
            { brand: { $regex: query, $options: 'i' } },
            { category: { $regex: query, $options: 'i' } }
        ]
    }).sort({ createdAt: -1 });
};

itemSchema.statics.searchItemsByManager = function(managerId, query) {
    return this.find({
        managerId,
        isActive: true,
        $or: [
            { name: { $regex: query, $options: 'i' } },
            { brand: { $regex: query, $options: 'i' } },
            { category: { $regex: query, $options: 'i' } }
        ]
    }).sort({ createdAt: -1 });
};

module.exports = mongoose.model('Item', itemSchema);
