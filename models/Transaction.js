const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['income', 'expense'],
        required: true
    },
    category: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    date: {
        type: Date,
        required: true,
        default: Date.now
    },
    paymentMethod: {
        type: String,
        enum: ['cash', 'card', 'bank_transfer', 'mobile', 'other'],
        default: 'cash'
    },
    reference: {
        type: String,
        trim: true,
        maxlength: 100
    },
    receipt: {
        type: String, // URL or path to receipt image
        trim: true
    },
    tags: [{
        type: String,
        trim: true,
        maxlength: 50
    }],
    saleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Sale'
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    deviceId: {
        type: String,
        required: true
    },
    isRecurring: {
        type: Boolean,
        default: false
    },
    recurringConfig: {
        frequency: {
            type: String,
            enum: ['daily', 'weekly', 'monthly', 'yearly']
        },
        interval: {
            type: Number,
            min: 1
        },
        endDate: Date
    },
    lastSynced: {
        type: Date,
        default: Date.now
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes
transactionSchema.index({ userId: 1, date: -1 });
transactionSchema.index({ type: 1 });
transactionSchema.index({ category: 1 });
transactionSchema.index({ saleId: 1 });
transactionSchema.index({ lastSynced: 1 });

// Pre-save middleware
transactionSchema.pre('save', function(next) {
    this.lastSynced = new Date();
    next();
});

// Static methods
transactionSchema.statics.findByUser = function(userId, limit = 50) {
    return this.find({ userId, isActive: true })
        .sort({ date: -1 })
        .limit(limit);
};

transactionSchema.statics.getFinancialSummary = function(userId, startDate, endDate) {
    return this.aggregate([
        {
            $match: {
                userId: new mongoose.Types.ObjectId(userId),
                date: { $gte: startDate, $lte: endDate },
                isActive: true
            }
        },
        {
            $group: {
                _id: '$type',
                total: { $sum: '$amount' },
                count: { $sum: 1 },
                average: { $avg: '$amount' }
            }
        }
    ]);
};

transactionSchema.statics.getCategoryBreakdown = function(userId, type, startDate, endDate) {
    return this.aggregate([
        {
            $match: {
                userId: new mongoose.Types.ObjectId(userId),
                type: type,
                date: { $gte: startDate, $lte: endDate },
                isActive: true
            }
        },
        {
            $group: {
                _id: '$category',
                total: { $sum: '$amount' },
                count: { $sum: 1 },
                percentage: { $sum: '$amount' }
            }
        },
        {
            $sort: { total: -1 }
        }
    ]);
};

transactionSchema.statics.getMonthlyTrend = function(userId, months = 12) {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    
    return this.aggregate([
        {
            $match: {
                userId: new mongoose.Types.ObjectId(userId),
                date: { $gte: startDate },
                isActive: true
            }
        },
        {
            $group: {
                _id: {
                    year: { $year: '$date' },
                    month: { $month: '$date' },
                    type: '$type'
                },
                total: { $sum: '$amount' },
                count: { $sum: 1 }
            }
        },
        {
            $sort: { '_id.year': 1, '_id.month': 1 }
        }
    ]);
};

module.exports = mongoose.model('Transaction', transactionSchema);
