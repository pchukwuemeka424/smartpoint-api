const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// Test endpoint to verify API is working
router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'Cashiers API is working',
        timestamp: new Date().toISOString()
    });
});

// GET /api/cashiers - Get all cashiers for the current manager
router.get('/', auth, async (req, res) => {
    try {
        // Only managers can access this endpoint
        if (req.user.role !== 'manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only managers can view cashiers.'
            });
        }

        const cashiers = await User.find({ 
            role: 'cashier',
            managerId: req.user.id, // Only show cashiers belonging to this manager
            isActive: true 
        }).select('-password -devices -verificationToken -resetPasswordToken -resetPasswordExpires');

        // Add some additional info for each cashier
        const cashiersWithInfo = cashiers.map(cashier => ({
            id: cashier._id,
            firstName: cashier.firstName,
            lastName: cashier.lastName,
            fullName: cashier.fullName,
            phone: cashier.phone,
            email: cashier.email,
            username: cashier.username,
            businessName: cashier.businessName,
            isActive: cashier.isActive,
            lastLogin: cashier.lastLogin,
            createdAt: cashier.createdAt,
            emailVerified: cashier.emailVerified,
            loginCode: cashier.loginCode, // Include login code for display
            // Add stats if needed
            totalSales: 0, // This would be calculated from sales collection
            totalTransactions: 0 // This would be calculated from transactions collection
        }));

        res.json({
            success: true,
            data: cashiersWithInfo
        });
        
    } catch (error) {
        console.error('Get cashiers error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get cashiers',
            error: error.message
        });
    }
});

// POST /api/cashiers - Create a new cashier
router.post('/', auth, async (req, res) => {
    try {
        console.log('Cashier creation request received');
        console.log('User role:', req.user.role);
        console.log('User ID:', req.user.id);
        console.log('Request body:', req.body);
        
        // Only managers can create cashiers
        if (req.user.role !== 'manager') {
            console.log('Access denied - user is not a manager');
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only managers can create cashiers.'
            });
        }

        const {
            firstName,
            lastName,
            username,
            password,
            businessName
        } = req.body;
        
        // Validate required fields
        if (!firstName || !username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Full name, username, and login code are required'
            });
        }
        
        // Validate username format
        const usernameRegex = /^[a-zA-Z0-9_]{3,50}$/;
        if (!usernameRegex.test(username)) {
            return res.status(400).json({
                success: false,
                message: 'Username must be 3-50 characters long and contain only letters, numbers, and underscores'
            });
        }
        
        // Check if cashier already exists
        const existingCashier = await User.findOne({
            $or: [{ username }, { email: username }]
        });
        
        if (existingCashier) {
            return res.status(400).json({
                success: false,
                message: 'Cashier with this username already exists'
            });
        }
        
        // Create new cashier
        const cashier = new User({
            username,
            email: username,
            password,
            loginCode: password, // Store the login code separately (not hashed)
            firstName,
            lastName: lastName || '', // Optional last name
            phone: '', // Optional phone field
            role: 'cashier',
            managerId: req.user.id, // Link cashier to the creating manager
            businessName: businessName || req.user.businessName || '',
            businessType: req.user.businessType || 'retail',
            currency: req.user.currency || 'NGN',
            taxRate: req.user.taxRate || 0,
            isActive: true, // Explicitly set as active
            emailVerified: true, // Cashiers created by managers are considered verified
            preferences: {
                theme: 'light',
                language: 'en',
                currency: req.user.currency || 'NGN',
                timezone: req.user.preferences?.timezone || 'Africa/Lagos',
                receiptTemplate: 'basic',
                autoBackup: true,
                offlineMode: true,
                notifications: {
                    sales: true,
                    inventory: true,
                    reports: false,
                    marketing: false,
                    push: true,
                    email: true,
                    sound: true,
                    lowStock: true,
                    dailyReports: false,
                    weeklyReports: true,
                    monthlyReports: true
                }
            }
        });
        
        await cashier.save();
        console.log('Cashier saved successfully:', cashier._id);
        
        // Return cashier without sensitive data
        const cashierResponse = {
            id: cashier._id,
            firstName: cashier.firstName,
            lastName: cashier.lastName,
            fullName: cashier.fullName,
            phone: cashier.phone,
            email: cashier.email,
            username: cashier.username,
            businessName: cashier.businessName,
            role: cashier.role,
            isActive: cashier.isActive,
            createdAt: cashier.createdAt,
            emailVerified: cashier.emailVerified,
            loginCode: cashier.loginCode
        };
        
        console.log('Sending response:', cashierResponse);
        
        res.status(201).json({
            success: true,
            data: cashierResponse,
            message: 'Cashier created successfully'
        });
        
    } catch (error) {
        console.error('Create cashier error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create cashier',
            error: error.message
        });
    }
});

// GET /api/cashiers/:id - Get specific cashier details
router.get('/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Only managers can access this endpoint
        if (req.user.role !== 'manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only managers can view cashier details.'
            });
        }

        const cashier = await User.findOne({
            _id: id,
            role: 'cashier',
            managerId: req.user.id, // Only allow access to cashiers belonging to this manager
            isActive: true
        }).select('-password -devices -verificationToken -resetPasswordToken -resetPasswordExpires');

        if (!cashier) {
            return res.status(404).json({
                success: false,
                message: 'Cashier not found'
            });
        }

        const cashierResponse = {
            id: cashier._id,
            firstName: cashier.firstName,
            lastName: cashier.lastName,
            fullName: cashier.fullName,
            phone: cashier.phone,
            email: cashier.email,
            businessName: cashier.businessName,
            role: cashier.role,
            isActive: cashier.isActive,
            lastLogin: cashier.lastLogin,
            createdAt: cashier.createdAt,
            emailVerified: cashier.emailVerified,
            preferences: cashier.preferences
        };

        res.json({
            success: true,
            data: cashierResponse
        });
        
    } catch (error) {
        console.error('Get cashier error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get cashier details',
            error: error.message
        });
    }
});

// PUT /api/cashiers/:id - Update cashier information
router.put('/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        // Only managers can update cashiers
        if (req.user.role !== 'manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only managers can update cashiers.'
            });
        }

        // Validate required fields
        if (!updates || Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No update data provided'
            });
        }

        const allowedUpdates = ['firstName', 'lastName', 'username', 'phone', 'businessName'];
        
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
                _id: { $ne: id },
                role: 'cashier'
            });
            
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: 'Username is already taken by another cashier'
                });
            }
        }

        // Validate phone format if phone is being updated
        if (updates.phone) {
            const phoneRegex = /^0[789][01]\d{8}$/;
            if (!phoneRegex.test(updates.phone)) {
                return res.status(400).json({
                    success: false,
                    message: 'Please enter a valid Nigerian phone number (11 digits, starting with 0)'
                });
            }
            
            // Check if phone is already taken by another user
            const existingUser = await User.findOne({
                phone: updates.phone,
                _id: { $ne: id },
                role: 'cashier'
            });
            
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: 'Phone number is already taken by another cashier'
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
        
        const cashier = await User.findOneAndUpdate(
            { _id: id, role: 'cashier', managerId: req.user.id, isActive: true },
            filteredUpdates,
            { new: true, runValidators: true }
        ).select('-password -devices -verificationToken -resetPasswordToken -resetPasswordExpires');
        
        if (!cashier) {
            return res.status(404).json({
                success: false,
                message: 'Cashier not found'
            });
        }

        const cashierResponse = {
            id: cashier._id,
            firstName: cashier.firstName,
            lastName: cashier.lastName,
            fullName: cashier.fullName,
            phone: cashier.phone,
            email: cashier.email,
            businessName: cashier.businessName,
            role: cashier.role,
            isActive: cashier.isActive,
            lastLogin: cashier.lastLogin,
            createdAt: cashier.createdAt,
            emailVerified: cashier.emailVerified
        };
        
        res.json({
            success: true,
            data: cashierResponse,
            message: 'Cashier updated successfully'
        });
        
    } catch (error) {
        console.error('Update cashier error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update cashier',
            error: error.message
        });
    }
});

// POST /api/cashiers/:id/reset-password - Reset cashier password
router.post('/:id/reset-password', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;
        
        // Only managers can reset cashier passwords
        if (req.user.role !== 'manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only managers can reset cashier passwords.'
            });
        }

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'New password is required and must be at least 6 characters long'
            });
        }

        const cashier = await User.findOne({
            _id: id,
            role: 'cashier',
            managerId: req.user.id,
            isActive: true
        });

        if (!cashier) {
            return res.status(404).json({
                success: false,
                message: 'Cashier not found'
            });
        }

        // Hash the new password and store the login code
        const salt = await bcrypt.genSalt(12);
        cashier.password = await bcrypt.hash(newPassword, salt);
        cashier.loginCode = newPassword; // Store the login code separately
        
        await cashier.save();
        
        res.json({
            success: true,
            message: 'Cashier password reset successfully',
            data: {
                loginCode: newPassword
            }
        });
        
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reset password',
            error: error.message
        });
    }
});

// DELETE /api/cashiers/:id - Deactivate cashier (soft delete)
router.delete('/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Only managers can deactivate cashiers
        if (req.user.role !== 'manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only managers can deactivate cashiers.'
            });
        }

        // Don't allow deactivating self
        if (req.user.id === id) {
            return res.status(400).json({
                success: false,
                message: 'You cannot deactivate your own account'
            });
        }

        const cashier = await User.findOneAndUpdate(
            { _id: id, role: 'cashier', managerId: req.user.id, isActive: true },
            { isActive: false },
            { new: true }
        ).select('firstName lastName phone email');
        
        if (!cashier) {
            return res.status(404).json({
                success: false,
                message: 'Cashier not found'
            });
        }
        
        res.json({
            success: true,
            message: `Cashier ${cashier.firstName} ${cashier.lastName} has been deactivated successfully`
        });
        
    } catch (error) {
        console.error('Deactivate cashier error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to deactivate cashier',
            error: error.message
        });
    }
});

// POST /api/cashiers/:id/reactivate - Reactivate cashier
router.post('/:id/reactivate', auth, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Only managers can reactivate cashiers
        if (req.user.role !== 'manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only managers can reactivate cashiers.'
            });
        }

        const cashier = await User.findOneAndUpdate(
            { _id: id, role: 'cashier', managerId: req.user.id, isActive: false },
            { isActive: true },
            { new: true }
        ).select('firstName lastName phone email isActive');
        
        if (!cashier) {
            return res.status(404).json({
                success: false,
                message: 'Cashier not found or already active'
            });
        }
        
        res.json({
            success: true,
            data: {
                id: cashier._id,
                firstName: cashier.firstName,
                lastName: cashier.lastName,
                phone: cashier.phone,
                email: cashier.email,
                isActive: cashier.isActive
            },
            message: `Cashier ${cashier.firstName} ${cashier.lastName} has been reactivated successfully`
        });
        
    } catch (error) {
        console.error('Reactivate cashier error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reactivate cashier',
            error: error.message
        });
    }
});

module.exports = router;
