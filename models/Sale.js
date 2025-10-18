const mongoose = require('mongoose');

const saleItemSchema = new mongoose.Schema({
    item: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Item',
        required: true
    },
    name: {
        type: String,
        required: true
    },
    price: {
        type: Number,
        required: true,
        min: 0
    },
    quantity: {
        type: Number,
        required: true,
        min: 1
    },
    subtotal: {
        type: Number,
        required: true,
        min: 0
    }
});

const saleSchema = new mongoose.Schema({
    receiptNumber: {
        type: String,
        required: true,
        unique: true
    },
    items: [saleItemSchema],
    subtotal: {
        type: Number,
        required: true,
        min: 0
    },
    tax: {
        type: Number,
        default: 0,
        min: 0
    },
    discount: {
        type: Number,
        default: 0,
        min: 0
    },
    total: {
        type: Number,
        required: true,
        min: 0
    },
    paymentMethod: {
        type: String,
        enum: ['cash', 'card', 'mobile', 'other'],
        default: 'cash'
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'completed', 'partial', 'failed', 'refunded'],
        default: 'completed'
    },
    paidAmount: {
        type: Number,
        default: 0,
        min: 0
    },
    change: {
        type: Number,
        default: 0,
        min: 0
    },
    customerName: {
        type: String,
        trim: true,
        maxlength: 200
    },
    customerPhone: {
        type: String,
        trim: true,
        maxlength: 20
    },
    customerEmail: {
        type: String,
        trim: true,
        maxlength: 200
    },
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Customer'
    },
    notes: {
        type: String,
        trim: true,
        maxlength: 500
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
            // Required if the sale was made by a cashier
            return this.userId && this.userId.toString() !== this.managerId.toString();
        }
    },
    deviceId: {
        type: String,
        required: true
    },
    saleDate: {
        type: Date,
        default: Date.now
    },
    lastSynced: {
        type: Date,
        default: Date.now
    },
    isOffline: {
        type: Boolean,
        default: false
    },
    syncStatus: {
        type: String,
        enum: ['synced', 'pending', 'failed'],
        default: 'synced'
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes
saleSchema.index({ userId: 1, saleDate: -1 });
saleSchema.index({ managerId: 1, saleDate: -1 });
saleSchema.index({ cashierId: 1, saleDate: -1 });
// Note: receiptNumber index is automatically created by unique: true
saleSchema.index({ paymentStatus: 1 });
saleSchema.index({ syncStatus: 1 });
saleSchema.index({ lastSynced: 1 });

// Virtual for formatted receipt number
saleSchema.virtual('formattedReceiptNumber').get(function() {
    return `RCP-${this.receiptNumber}`;
});

// Pre-save middleware to calculate totals
saleSchema.pre('save', function(next) {
    // Calculate subtotal from items
    this.subtotal = this.items.reduce((sum, item) => sum + item.subtotal, 0);
    
    // Calculate total (subtotal + tax - discount)
    this.total = this.subtotal + this.tax - this.discount;
    
    // Calculate change if not provided
    if (this.paidAmount !== undefined && this.change === undefined) {
        this.change = Math.max(0, this.paidAmount - this.total);
    }
    
    // Update payment status based on paid amount
    if (this.paidAmount !== undefined) {
        if (this.paidAmount === 0) {
            this.paymentStatus = 'pending';
        } else if (this.paidAmount >= this.total) {
            this.paymentStatus = 'completed';
        } else {
            this.paymentStatus = 'partial';
        }
    }
    
    // Update sync timestamp
    this.lastSynced = new Date();
    
    next();
});

// Static methods
saleSchema.statics.findByUser = function(userId, limit = 50) {
    return this.find({ userId })
        .populate('items.item', 'name category')
        .sort({ saleDate: -1 })
        .limit(limit);
};

saleSchema.statics.findByManager = function(managerId, limit = 50) {
    return this.find({ managerId })
        .populate('items.item', 'name category')
        .populate('cashierId', 'firstName lastName')
        .sort({ saleDate: -1 })
        .limit(limit);
};

saleSchema.statics.findByCashier = function(cashierId, limit = 50) {
    return this.find({ cashierId })
        .populate('items.item', 'name category')
        .sort({ saleDate: -1 })
        .limit(limit);
};

saleSchema.statics.getDailySales = function(userId, date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    return this.find({
        userId,
        saleDate: { $gte: startOfDay, $lte: endOfDay },
        paymentStatus: 'completed'
    }).populate('items.item', 'name category');
};

saleSchema.statics.getSalesReport = function(userId, startDate, endDate) {
    return this.aggregate([
        {
            $match: {
                userId: new mongoose.Types.ObjectId(userId),
                saleDate: { $gte: startDate, $lte: endDate },
                paymentStatus: 'completed'
            }
        },
        {
            $group: {
                _id: null,
                totalSales: { $sum: '$total' },
                totalTransactions: { $sum: 1 },
                averageTransaction: { $avg: '$total' },
                totalItems: { $sum: { $sum: '$items.quantity' } }
            }
        }
    ]);
};

saleSchema.statics.getTopItems = function(userId, startDate, endDate, limit = 10) {
    return this.aggregate([
        {
            $match: {
                userId: new mongoose.Types.ObjectId(userId),
                saleDate: { $gte: startDate, $lte: endDate },
                paymentStatus: 'completed'
            }
        },
        { $unwind: '$items' },
        {
            $group: {
                _id: '$items.item',
                totalQuantity: { $sum: '$items.quantity' },
                totalRevenue: { $sum: '$items.subtotal' },
                itemName: { $first: '$items.name' }
            }
        },
        { $sort: { totalQuantity: -1 } },
        { $limit: limit }
    ]);
};

module.exports = mongoose.model('Sale', saleSchema);
