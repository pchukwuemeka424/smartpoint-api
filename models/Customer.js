const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200
    },
    email: {
        type: String,
        trim: true,
        lowercase: true,
        maxlength: 200,
        sparse: true
    },
    phone: {
        type: String,
        required: true,
        trim: true,
        maxlength: 20
    },
    address: {
        street: {
            type: String,
            trim: true,
            maxlength: 200
        },
        city: {
            type: String,
            trim: true,
            maxlength: 100
        },
        state: {
            type: String,
            trim: true,
            maxlength: 100
        },
        zipCode: {
            type: String,
            trim: true,
            maxlength: 20
        },
        country: {
            type: String,
            trim: true,
            maxlength: 100,
            default: 'Nigeria'
        }
    },
    dateOfBirth: {
        type: Date
    },
    gender: {
        type: String,
        enum: ['male', 'female', 'other', 'prefer_not_to_say'],
        default: 'prefer_not_to_say'
    },
    customerType: {
        type: String,
        enum: ['individual', 'business'],
        default: 'individual'
    },
    businessName: {
        type: String,
        trim: true,
        maxlength: 200
    },
    businessType: {
        type: String,
        trim: true,
        maxlength: 100
    },
    taxId: {
        type: String,
        trim: true,
        maxlength: 50
    },
    loyaltyPoints: {
        type: Number,
        default: 0,
        min: 0
    },
    totalSpent: {
        type: Number,
        default: 0,
        min: 0
    },
    lastPurchaseDate: {
        type: Date
    },
    notes: {
        type: String,
        trim: true,
        maxlength: 1000
    },
    tags: [{
        type: String,
        trim: true,
        maxlength: 50
    }],
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

// Indexes
customerSchema.index({ userId: 1, name: 1 });
customerSchema.index({ managerId: 1, name: 1 });
customerSchema.index({ phone: 1 });
customerSchema.index({ lastSynced: 1 });
customerSchema.index({ isActive: 1 });

// Virtual for full name
customerSchema.virtual('fullName').get(function() {
    if (this.customerType === 'business' && this.businessName) {
        return this.businessName;
    }
    return this.name;
});

// Virtual for display name
customerSchema.virtual('displayName').get(function() {
    if (this.customerType === 'business' && this.businessName) {
        return `${this.businessName} (${this.name})`;
    }
    return this.name;
});

// Pre-save middleware
customerSchema.pre('save', function(next) {
    // Update lastSynced timestamp
    this.lastSynced = new Date();
    
    // Ensure business fields are only set for business customers
    if (this.customerType === 'individual') {
        this.businessName = undefined;
        this.businessType = undefined;
        this.taxId = undefined;
    }
    
    next();
});

// Static method to find customers by manager
customerSchema.statics.findByManager = function(managerId, options = {}) {
    return this.find({ managerId, isActive: true }, null, options);
};

// Static method to search customers
customerSchema.statics.searchCustomers = function(managerId, searchTerm, options = {}) {
    const searchRegex = new RegExp(searchTerm, 'i');
    return this.find({
        managerId,
        isActive: true,
        $or: [
            { name: searchRegex },
            { email: searchRegex },
            { phone: searchRegex },
            { businessName: searchRegex }
        ]
    }, null, options);
};

module.exports = mongoose.model('Customer', customerSchema);
