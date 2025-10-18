const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        minlength: 3,
        maxlength: 50
    },
    email: {
        type: String,
        required: false,
        unique: true,
        sparse: true,
        trim: true,
        lowercase: true,
        maxlength: 200
    },
    password: {
        type: String,
        required: true,
        minlength: 6
    },
    firstName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    lastName: {
        type: String,
        required: false,
        trim: true,
        maxlength: 100,
        default: ''
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
    phone: {
        type: String,
        trim: true,
        maxlength: 20
    },
    role: {
        type: String,
        enum: ['manager', 'cashier'],
        default: 'manager'
    },
    loginCode: {
        type: String,
        required: false,
        maxlength: 10
    },
    managerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: function() {
            return this.role === 'cashier';
        }
    },
    address: {
        street: String,
        city: String,
        state: String,
        zipCode: String,
        country: String
    },
    currency: {
        type: String,
        default: 'NGN',
        maxlength: 3
    },
    taxRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 1
    },
    devices: [{
        deviceId: {
            type: String,
            required: true
        },
        deviceName: {
            type: String,
            required: true
        },
        deviceType: {
            type: String,
            enum: ['mobile', 'tablet', 'desktop', 'phone'],
            default: 'mobile'
        },
        lastActive: {
            type: Date,
            default: Date.now
        },
        isActive: {
            type: Boolean,
            default: true
        }
    }],
    preferences: {
        theme: {
            type: String,
            enum: ['light', 'dark', 'auto'],
            default: 'light'
        },
        language: {
            type: String,
            default: 'en'
        },
        currency: {
            type: String,
            default: 'NGN'
        },
        timezone: {
            type: String,
            default: 'Africa/Lagos'
        },
        receiptTemplate: {
            type: String,
            enum: ['basic', 'detailed', 'minimal'],
            default: 'basic'
        },
        autoBackup: {
            type: Boolean,
            default: true
        },
        offlineMode: {
            type: Boolean,
            default: true
        },
        notifications: {
            sales: {
                type: Boolean,
                default: true
            },
            inventory: {
                type: Boolean,
                default: true
            },
            reports: {
                type: Boolean,
                default: true
            },
            marketing: {
                type: Boolean,
                default: false
            },
            push: {
                type: Boolean,
                default: true
            },
            email: {
                type: Boolean,
                default: true
            },
            sound: {
                type: Boolean,
                default: true
            },
            lowStock: {
                type: Boolean,
                default: true
            },
            dailyReports: {
                type: Boolean,
                default: false
            },
            weeklyReports: {
                type: Boolean,
                default: true
            },
            monthlyReports: {
                type: Boolean,
                default: true
            }
        }
    },
    subscription: {
        plan: {
            type: String,
            enum: ['free', 'basic', 'premium'],
            default: 'free'
        },
        startDate: {
            type: Date,
            default: Date.now
        },
        endDate: Date,
        isActive: {
            type: Boolean,
            default: true
        }
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastLogin: {
        type: Date,
        default: Date.now
    },
    emailVerified: {
        type: Boolean,
        default: false
    },
    verificationToken: String,
    resetPasswordToken: String,
    resetPasswordExpires: Date
}, {
    timestamps: true,
    toJSON: { 
        virtuals: true,
        transform: function(doc, ret) {
            delete ret.password;
            delete ret.verificationToken;
            delete ret.resetPasswordToken;
            delete ret.resetPasswordExpires;
            return ret;
        }
    },
    toObject: { virtuals: true }
});

// Indexes
// Note: email and username indexes are automatically created by unique: true
userSchema.index({ 'devices.deviceId': 1 });

// Virtual for full name
userSchema.virtual('fullName').get(function() {
    return `${this.firstName} ${this.lastName}`;
});

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    
    try {
        const salt = await bcrypt.genSalt(12);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Instance methods
userSchema.methods.comparePassword = async function(candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.addDevice = function(deviceInfo) {
    // Remove existing device with same ID
    this.devices = this.devices.filter(device => device.deviceId !== deviceInfo.deviceId);
    
    // Add new device
    this.devices.push({
        ...deviceInfo,
        lastActive: new Date(),
        isActive: true
    });
    
    return this.save();
};

userSchema.methods.updateDeviceActivity = function(deviceId) {
    const device = this.devices.find(d => d.deviceId === deviceId);
    if (device) {
        device.lastActive = new Date();
        return this.save();
    }
    return Promise.resolve(this);
};

userSchema.methods.deactivateDevice = function(deviceId) {
    const device = this.devices.find(d => d.deviceId === deviceId);
    if (device) {
        device.isActive = false;
        return this.save();
    }
    return Promise.resolve(this);
};

// Static methods
userSchema.statics.findByEmail = function(email) {
    return this.findOne({ email: email.toLowerCase(), isActive: true });
};

userSchema.statics.findByUsername = function(username) {
    return this.findOne({ username, isActive: true });
};

module.exports = mongoose.model('User', userSchema);
