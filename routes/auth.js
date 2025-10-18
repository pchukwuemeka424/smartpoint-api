const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// Generate JWT token
const generateToken = (userId) => {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// POST /api/auth/register - Register new user
router.post('/register', async (req, res) => {
    try {
        const {
            businessName,
            username,
            password,
            role,
            deviceInfo
        } = req.body;
        
        // Validate required fields
        if (!businessName || !username || !password || !role) {
            return res.status(400).json({
                message: 'Business name, username, password, and role are required'
            });
        }
        
        // Validate username format
        const usernameRegex = /^[a-zA-Z0-9_]{3,50}$/;
        if (!usernameRegex.test(username)) {
            return res.status(400).json({
                message: 'Username must be 3-50 characters long and contain only letters, numbers, and underscores'
            });
        }
        
        // Check if user already exists
        const existingUser = await User.findOne({
            $or: [{ username }, { email: username }] // Check both username and email fields
        });
        
        if (existingUser) {
            return res.status(400).json({
                message: 'User with this username already exists'
            });
        }
        
        // Use businessName as both firstName and businessName
        const firstName = businessName.trim();
        const lastName = '';
        
        // Create new user
        const user = new User({
            username,
            email: username, // Use username as email for compatibility
            password,
            firstName,
            lastName,
            phone: '', // Optional phone field
            role: role || 'manager',
            businessName: businessName.trim(),
            businessType: 'retail'
        });
        
        // Add device info if provided
        if (deviceInfo) {
            user.devices.push({
                deviceId: deviceInfo.deviceId || uuidv4(),
                deviceName: deviceInfo.deviceName || 'Unknown Device',
                deviceType: deviceInfo.deviceType || 'mobile',
                lastActive: new Date(),
                isActive: true
            });
        }
        
        await user.save();
        
        // Generate token
        const token = generateToken(user._id);
        
        res.status(201).json({
            success: true,
            data: {
                user,
                token,
                deviceId: user.devices[0]?.deviceId
            },
            message: 'User registered successfully'
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            message: 'Registration failed',
            error: error.message
        });
    }
});

// POST /api/auth/login - Login user
router.post('/login', async (req, res) => {
    try {
        const { username, password, deviceInfo, role } = req.body;
        
        console.log('Login attempt:', { username, role, passwordLength: password?.length });
        
        if (!username || !password) {
            return res.status(400).json({
                message: 'Username and password are required'
            });
        }
        
        // Find user by username and ensure they are active
        const user = await User.findOne({ 
            username,
            isActive: true  // Only allow active users to login
        });
        if (!user) {
            console.log('User not found:', username);
            return res.status(401).json({
                message: 'Invalid username or password'
            });
        }
        
        console.log('User found:', { username: user.username, role: user.role, hasLoginCode: !!user.loginCode });
        
        // Check role if provided (check both direct role and role in deviceInfo)
        const requestedRole = role || deviceInfo?.role;
        if (requestedRole && user.role !== requestedRole) {
            console.log('Role mismatch:', { requested: requestedRole, actual: user.role });
            return res.status(401).json({
                message: `Invalid role. Expected ${requestedRole} but user is ${user.role}`
            });
        }
        
        // Check password
        const isMatch = await user.comparePassword(password);
        console.log('Password match result:', isMatch);
        if (!isMatch) {
            console.log('Password comparison failed for user:', username);
            return res.status(401).json({
                message: 'Invalid username or password'
            });
        }
        
        // Add or update device info
        let deviceId;
        if (deviceInfo) {
            deviceId = deviceInfo.deviceId || uuidv4();
            await user.addDevice({
                deviceId,
                deviceName: deviceInfo.deviceName || 'Unknown Device',
                deviceType: deviceInfo.deviceType || 'mobile'
            });
        }
        
        // Update last login
        user.lastLogin = new Date();
        await user.save();
        
        // Generate token
        const token = generateToken(user._id);
        
        // Return user data without sensitive information
        const userResponse = {
            id: user._id.toString(),
            username: user.username,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            fullName: user.fullName,
            phone: user.phone,
            role: user.role,
            managerId: user.managerId ? user.managerId.toString() : undefined,
            businessName: user.businessName,
            businessType: user.businessType,
            address: user.address,
            currency: user.currency,
            taxRate: user.taxRate,
            preferences: user.preferences,
            isActive: user.isActive,
            emailVerified: user.emailVerified,
            lastLogin: user.lastLogin,
            createdAt: user.createdAt
        };
        
        res.json({
            success: true,
            data: {
                user: userResponse,
                token,
                deviceId
            },
            message: 'Login successful'
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            message: 'Login failed',
            error: error.message
        });
    }
});

// GET /api/auth/me - Get current user
router.get('/me', auth, async (req, res) => {
    try {
        res.json({
            success: true,
            data: req.user
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            message: 'Failed to get user information',
            error: error.message
        });
    }
});

// GET /api/auth/profile - Get detailed user profile with statistics
router.get('/profile', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password -devices');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Get user statistics from related collections
        const Item = require('../models/Item');
        const Sale = require('../models/Sale');
        
        // Calculate statistics
        const [totalProducts, totalSales, recentSales] = await Promise.all([
            Item.countDocuments({ userId: user._id, isActive: true }),
            Sale.countDocuments({ userId: user._id }),
            Sale.aggregate([
                { $match: { userId: user._id } },
                { $group: { _id: null, totalAmount: { $sum: '$total' } } }
            ])
        ]);

        const totalSalesAmount = recentSales.length > 0 ? recentSales[0].totalAmount : 0;
        
        // Get recent activity
        const recentActivity = await Sale.find({ userId: user._id })
            .sort({ createdAt: -1 })
            .limit(5)
            .select('total createdAt receiptNumber');

        // Return address as structured object
        const addressData = user.address || null;
        
        // Build comprehensive profile
        const profile = {
            id: user._id.toString(),
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User',
            email: user.email || '',
            phone: user.phone || '',
            role: user.role || 'manager',
            businessName: user.businessName || 'My Business',
            businessType: user.businessType || 'Retail',
            address: addressData,
            currency: user.currency || 'NGN',
            taxRate: user.taxRate || 0,
            preferences: {
                theme: user.preferences?.theme || 'light',
                language: user.preferences?.language || 'en',
                currency: user.preferences?.currency || 'NGN',
                timezone: user.preferences?.timezone || 'Africa/Lagos',
                receiptTemplate: user.preferences?.receiptTemplate || 'basic',
                autoBackup: user.preferences?.autoBackup ?? true,
                offlineMode: user.preferences?.offlineMode ?? true,
                notifications: {
                    sales: user.preferences?.notifications?.sales ?? true,
                    inventory: user.preferences?.notifications?.inventory ?? true,
                    reports: user.preferences?.notifications?.reports ?? true,
                    marketing: user.preferences?.notifications?.marketing ?? false
                }
            },
            stats: {
                totalSales: totalSalesAmount,
                totalOrders: totalSales,
                totalProducts: totalProducts,
                joinDate: user.createdAt,
                lastLogin: user.lastLogin || user.createdAt,
                recentActivity: recentActivity.map(sale => ({
                    id: sale._id,
                    amount: sale.total,
                    date: sale.createdAt,
                    receiptNumber: sale.receiptNumber
                }))
            },
            subscription: {
                plan: user.subscription?.plan || 'free',
                isActive: user.subscription?.isActive ?? true,
                startDate: user.subscription?.startDate || user.createdAt,
                endDate: user.subscription?.endDate
            },
            isActive: user.isActive,
            emailVerified: user.emailVerified,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
        };
        
        res.json({
            success: true,
            data: profile
        });
        
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get profile information',
            error: error.message
        });
    }
});

// PUT /api/auth/profile - Update user profile
router.put('/profile', auth, async (req, res) => {
    try {
        const updates = req.body;
        const allowedUpdates = [
            'firstName', 'lastName', 'businessName', 'businessType',
            'username', 'phone', 'address', 'currency', 'taxRate', 'preferences'
        ];
        
        // Validate required fields
        if (!updates || Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No update data provided'
            });
        }
        
        // Validate username format if username is being updated
        if (updates.username) {
            const usernameRegex = /^[a-zA-Z0-9_]{3,50}$/;
            if (!usernameRegex.test(updates.username)) {
                return res.status(400).json({
                    success: false,
                    message: 'Username must be 3-50 characters long and contain only letters, numbers, and underscores'
                });
            }
            
            // Check if username is already taken by another user
            const existingUser = await User.findOne({
                username: updates.username,
                _id: { $ne: req.user.id }
            });
            
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: 'Username is already taken by another user'
                });
            }
        }

        // Validate phone format if phone is being updated
        if (updates.phone && updates.phone.trim() !== '') {
            // Remove spaces and validate
            const cleanPhone = updates.phone.replace(/\s/g, '');
            
            // Check if it's a valid phone number (flexible validation)
            if (cleanPhone.length < 10 || cleanPhone.length > 15) {
                return res.status(400).json({
                    success: false,
                    message: 'Please enter a valid phone number (10-15 digits)'
                });
            }
            
            // Update with cleaned phone number
            updates.phone = cleanPhone;
        }

        // Validate tax rate if provided
        if (updates.taxRate !== undefined) {
            if (typeof updates.taxRate !== 'number' || updates.taxRate < 0 || updates.taxRate > 1) {
                return res.status(400).json({
                    success: false,
                    message: 'Tax rate must be a number between 0 and 1'
                });
            }
        }
        
        // Filter allowed updates
        const filteredUpdates = {};
        Object.keys(updates).forEach(key => {
            if (allowedUpdates.includes(key)) {
                filteredUpdates[key] = updates[key];
            }
        });
        
        // Update email if username is updated (for compatibility)
        if (filteredUpdates.username) {
            filteredUpdates.email = filteredUpdates.username;
        }
        
        // Handle address formatting
        if (filteredUpdates.address) {
            if (typeof filteredUpdates.address === 'string') {
                // Convert string address to structured format
                const addressParts = filteredUpdates.address.split(',');
                filteredUpdates.address = {
                    street: addressParts[0]?.trim() || '',
                    city: addressParts[1]?.trim() || '',
                    state: addressParts[2]?.trim() || '',
                    zipCode: addressParts[3]?.trim() || '',
                    country: addressParts[4]?.trim() || 'Nigeria'
                };
            } else if (typeof filteredUpdates.address === 'object') {
                // Address is already in object format, validate and clean it
                filteredUpdates.address = {
                    street: filteredUpdates.address.street?.trim() || '',
                    city: filteredUpdates.address.city?.trim() || '',
                    state: filteredUpdates.address.state?.trim() || '',
                    zipCode: filteredUpdates.address.zipCode?.trim() || '',
                    country: filteredUpdates.address.country?.trim() || 'Nigeria'
                };
            }
        }
        
        const user = await User.findByIdAndUpdate(
            req.user.id,
            filteredUpdates,
            { new: true, runValidators: true }
        ).select('-password -devices');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Return address as structured object
        const addressData = user.address || null;
        
        // Return formatted profile data
        const profile = {
            id: user._id.toString(),
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User',
            email: user.email || '',
            phone: user.phone || '',
            role: user.role || 'manager',
            businessName: user.businessName || 'My Business',
            businessType: user.businessType || 'Retail',
            address: addressData,
            currency: user.currency || 'NGN',
            taxRate: user.taxRate || 0,
            preferences: {
                theme: user.preferences?.theme || 'light',
                language: user.preferences?.language || 'en',
                currency: user.preferences?.currency || 'NGN',
                timezone: user.preferences?.timezone || 'Africa/Lagos',
                receiptTemplate: user.preferences?.receiptTemplate || 'basic',
                autoBackup: user.preferences?.autoBackup ?? true,
                offlineMode: user.preferences?.offlineMode ?? true,
                notifications: {
                    sales: user.preferences?.notifications?.sales ?? true,
                    inventory: user.preferences?.notifications?.inventory ?? true,
                    reports: user.preferences?.notifications?.reports ?? true,
                    marketing: user.preferences?.notifications?.marketing ?? false
                }
            },
            subscription: {
                plan: user.subscription?.plan || 'free',
                isActive: user.subscription?.isActive ?? true,
                startDate: user.subscription?.startDate || user.createdAt,
                endDate: user.subscription?.endDate
            },
            isActive: user.isActive,
            emailVerified: user.emailVerified,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
        };
        
        res.json({
            success: true,
            data: profile,
            message: 'Profile updated successfully'
        });
        
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update profile',
            error: error.message
        });
    }
});

// POST /api/auth/logout - Logout user (deactivate device)
router.post('/logout', auth, async (req, res) => {
    try {
        const deviceId = req.header('X-Device-ID');
        
        if (deviceId) {
            await req.user.deactivateDevice(deviceId);
        }
        
        res.json({
            success: true,
            message: 'Logged out successfully'
        });
        
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            message: 'Logout failed',
            error: error.message
        });
    }
});

// GET /api/auth/devices - Get user devices
router.get('/devices', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('devices');
        
        res.json({
            success: true,
            data: user.devices
        });
        
    } catch (error) {
        console.error('Get devices error:', error);
        res.status(500).json({
            message: 'Failed to get devices',
            error: error.message
        });
    }
});

// DELETE /api/auth/devices/:deviceId - Remove device
router.delete('/devices/:deviceId', auth, async (req, res) => {
    try {
        const { deviceId } = req.params;
        
        await req.user.deactivateDevice(deviceId);
        
        res.json({
            success: true,
            message: 'Device removed successfully'
        });
        
    } catch (error) {
        console.error('Remove device error:', error);
        res.status(500).json({
            message: 'Failed to remove device',
            error: error.message
        });
    }
});

// GET /api/auth/notifications/settings - Get notification settings
router.get('/notifications/settings', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('preferences.notifications');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const notificationSettings = {
            sales: user.preferences?.notifications?.sales ?? true,
            inventory: user.preferences?.notifications?.inventory ?? true,
            reports: user.preferences?.notifications?.reports ?? true,
            marketing: user.preferences?.notifications?.marketing ?? false,
            push: user.preferences?.notifications?.push ?? true,
            email: user.preferences?.notifications?.email ?? true,
            sound: user.preferences?.notifications?.sound ?? true,
            lowStock: user.preferences?.notifications?.lowStock ?? true,
            dailyReports: user.preferences?.notifications?.dailyReports ?? false,
            weeklyReports: user.preferences?.notifications?.weeklyReports ?? true,
            monthlyReports: user.preferences?.notifications?.monthlyReports ?? true
        };

        res.json({
            success: true,
            data: notificationSettings
        });
        
    } catch (error) {
        console.error('Get notification settings error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get notification settings',
            error: error.message
        });
    }
});

// PUT /api/auth/notifications/settings - Update notification settings
router.put('/notifications/settings', auth, async (req, res) => {
    try {
        const notificationUpdates = req.body;
        
        // Validate required fields
        if (!notificationUpdates || Object.keys(notificationUpdates).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No notification settings provided'
            });
        }

        // Define allowed notification settings
        const allowedSettings = [
            'sales', 'inventory', 'reports', 'marketing', 'push', 'email', 
            'sound', 'lowStock', 'dailyReports', 'weeklyReports', 'monthlyReports'
        ];

        // Validate and filter notification settings
        const filteredSettings = {};
        Object.keys(notificationUpdates).forEach(key => {
            if (allowedSettings.includes(key) && typeof notificationUpdates[key] === 'boolean') {
                filteredSettings[key] = notificationUpdates[key];
            }
        });

        if (Object.keys(filteredSettings).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid notification settings provided'
            });
        }

        // Update user notification preferences
        const updateQuery = {};
        Object.keys(filteredSettings).forEach(key => {
            updateQuery[`preferences.notifications.${key}`] = filteredSettings[key];
        });

        const user = await User.findByIdAndUpdate(
            req.user.id,
            { $set: updateQuery },
            { new: true, runValidators: true }
        ).select('preferences.notifications');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Return updated notification settings
        const notificationSettings = {
            sales: user.preferences?.notifications?.sales ?? true,
            inventory: user.preferences?.notifications?.inventory ?? true,
            reports: user.preferences?.notifications?.reports ?? true,
            marketing: user.preferences?.notifications?.marketing ?? false,
            push: user.preferences?.notifications?.push ?? true,
            email: user.preferences?.notifications?.email ?? true,
            sound: user.preferences?.notifications?.sound ?? true,
            lowStock: user.preferences?.notifications?.lowStock ?? true,
            dailyReports: user.preferences?.notifications?.dailyReports ?? false,
            weeklyReports: user.preferences?.notifications?.weeklyReports ?? true,
            monthlyReports: user.preferences?.notifications?.monthlyReports ?? true
        };

        res.json({
            success: true,
            data: notificationSettings,
            message: 'Notification settings updated successfully'
        });
        
    } catch (error) {
        console.error('Update notification settings error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update notification settings',
            error: error.message
        });
    }
});

// POST /api/auth/notifications/test - Test notification settings
router.post('/notifications/test', auth, async (req, res) => {
    try {
        const { type } = req.body;
        
        if (!type) {
            return res.status(400).json({
                success: false,
                message: 'Notification type is required'
            });
        }

        const user = await User.findById(req.user.id).select('preferences.notifications phone firstName lastName');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Check if notification type is enabled
        const notificationEnabled = user.preferences?.notifications?.[type];
        
        if (!notificationEnabled) {
            return res.status(400).json({
                success: false,
                message: `${type} notifications are disabled for this user`
            });
        }

        // Here you would integrate with your notification service
        // For now, we'll just return a success message
        const testMessage = `Test ${type} notification sent successfully to ${user.firstName} ${user.lastName}`;
        
        res.json({
            success: true,
            message: testMessage,
            data: {
                type,
                recipient: {
                    name: `${user.firstName} ${user.lastName}`,
                    phone: user.phone
                },
                timestamp: new Date()
            }
        });
        
    } catch (error) {
        console.error('Test notification error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send test notification',
            error: error.message
        });
    }
});

// GET /api/auth/manager/business-info - Get manager's business information (for cashiers generating invoices)
router.get('/manager/business-info', auth, async (req, res) => {
    try {
        const currentUser = await User.findById(req.user.id);
        
        if (!currentUser) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        let managerId;
        
        // If user is a cashier, get their manager's ID
        if (currentUser.role === 'cashier') {
            managerId = currentUser.managerId;
        } else {
            // If user is a manager, use their own ID
            managerId = currentUser._id;
        }
        
        if (!managerId) {
            return res.status(400).json({
                success: false,
                message: 'No manager associated with this account'
            });
        }
        
        // Fetch manager's business information
        const manager = await User.findById(managerId).select('businessName businessType phone address taxId');
        
        if (!manager) {
            return res.status(404).json({
                success: false,
                message: 'Manager not found'
            });
        }
        
        res.json({
            success: true,
            data: {
                businessName: manager.businessName,
                businessType: manager.businessType,
                phone: manager.phone,
                address: manager.address,
                taxId: manager.taxId
            }
        });
        
    } catch (error) {
        console.error('Get manager business info error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get manager business information',
            error: error.message
        });
    }
});

// DELETE /api/auth/account - Delete user account (soft delete)
router.delete('/account', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { confirmPassword } = req.body;
        
        console.log('Delete account request received:', { userId });
        
        // Find the user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Verify password if provided
        if (confirmPassword) {
            const isPasswordValid = await user.comparePassword(confirmPassword);
            if (!isPasswordValid) {
                return res.status(401).json({
                    success: false,
                    message: 'Incorrect password'
                });
            }
        }
        
        // Soft delete - deactivate account instead of hard delete
        user.isActive = false;
        user.deletedAt = new Date();
        user.deletedReason = 'User requested account deletion';
        await user.save();
        
        console.log('✅ Account deactivated successfully:', userId);
        
        res.json({
            success: true,
            message: 'Account deleted successfully. Your data will be permanently removed after 30 days.'
        });
        
    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete account',
            error: error.message
        });
    }
});

module.exports = router;
