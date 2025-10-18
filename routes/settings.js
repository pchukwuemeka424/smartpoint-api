const express = require('express');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/settings/general - Get general settings
router.get('/general', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('preferences firstName lastName email username');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const generalSettings = {
            theme: user.preferences?.theme || 'light',
            language: user.preferences?.language || 'en',
            currency: user.preferences?.currency || user.currency || 'NGN',
            timezone: user.preferences?.timezone || 'Africa/Lagos',
            dateFormat: 'DD/MM/YYYY', // Default format
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            email: user.email || '',
            username: user.username || ''
        };

        res.json({
            success: true,
            data: generalSettings
        });
        
    } catch (error) {
        console.error('Get general settings error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get general settings',
            error: error.message
        });
    }
});

// PUT /api/settings/general - Update general settings
router.put('/general', auth, async (req, res) => {
    try {
        const updates = req.body;
        const allowedUpdates = [
            'firstName', 'lastName', 'email', 'username'
        ];
        const allowedPreferences = [
            'theme', 'language', 'currency', 'timezone'
        ];
        
        // Validate required fields
        if (!updates || Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No update data provided'
            });
        }

        // Filter allowed updates
        const filteredUpdates = {};
        const preferenceUpdates = {};
        
        Object.keys(updates).forEach(key => {
            if (allowedUpdates.includes(key)) {
                filteredUpdates[key] = updates[key];
            } else if (allowedPreferences.includes(key)) {
                preferenceUpdates[key] = updates[key];
            }
        });

        // Update email if username is updated (for compatibility)
        if (filteredUpdates.username) {
            filteredUpdates.email = filteredUpdates.username;
        }

        // Prepare update query
        const updateQuery = { ...filteredUpdates };
        if (Object.keys(preferenceUpdates).length > 0) {
            Object.keys(preferenceUpdates).forEach(key => {
                updateQuery[`preferences.${key}`] = preferenceUpdates[key];
            });
        }

        const user = await User.findByIdAndUpdate(
            req.user.id,
            updateQuery,
            { new: true, runValidators: true }
        ).select('-password -devices');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Return updated general settings
        const generalSettings = {
            theme: user.preferences?.theme || 'light',
            language: user.preferences?.language || 'en',
            currency: user.preferences?.currency || user.currency || 'NGN',
            timezone: user.preferences?.timezone || 'Africa/Lagos',
            dateFormat: 'DD/MM/YYYY',
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            email: user.email || '',
            username: user.username || ''
        };

        res.json({
            success: true,
            data: generalSettings,
            message: 'General settings updated successfully'
        });
        
    } catch (error) {
        console.error('Update general settings error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update general settings',
            error: error.message
        });
    }
});

// GET /api/settings/business - Get business settings
router.get('/business', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('businessName businessType taxRate preferences.receiptTemplate preferences.autoBackup');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const businessSettings = {
            businessName: user.businessName || 'My Business',
            businessType: user.businessType || 'Retail',
            taxRate: user.taxRate || 0,
            receiptTemplate: user.preferences?.receiptTemplate || 'basic',
            autoBackup: user.preferences?.autoBackup ?? true,
            dataRetention: 365 // Default value
        };

        res.json({
            success: true,
            data: businessSettings
        });
        
    } catch (error) {
        console.error('Get business settings error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get business settings',
            error: error.message
        });
    }
});

// PUT /api/settings/business - Update business settings
router.put('/business', auth, async (req, res) => {
    try {
        const updates = req.body;
        const allowedUpdates = [
            'businessName', 'businessType', 'taxRate'
        ];
        const allowedPreferences = [
            'receiptTemplate', 'autoBackup'
        ];
        
        // Validate required fields
        if (!updates || Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No update data provided'
            });
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
        const preferenceUpdates = {};
        
        Object.keys(updates).forEach(key => {
            if (allowedUpdates.includes(key)) {
                filteredUpdates[key] = updates[key];
            } else if (allowedPreferences.includes(key)) {
                preferenceUpdates[key] = updates[key];
            }
        });

        // Prepare update query
        const updateQuery = { ...filteredUpdates };
        if (Object.keys(preferenceUpdates).length > 0) {
            Object.keys(preferenceUpdates).forEach(key => {
                updateQuery[`preferences.${key}`] = preferenceUpdates[key];
            });
        }

        const user = await User.findByIdAndUpdate(
            req.user.id,
            updateQuery,
            { new: true, runValidators: true }
        ).select('businessName businessType taxRate preferences.receiptTemplate preferences.autoBackup');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Return updated business settings
        const businessSettings = {
            businessName: user.businessName || 'My Business',
            businessType: user.businessType || 'Retail',
            taxRate: user.taxRate || 0,
            receiptTemplate: user.preferences?.receiptTemplate || 'basic',
            autoBackup: user.preferences?.autoBackup ?? true,
            dataRetention: 365
        };

        res.json({
            success: true,
            data: businessSettings,
            message: 'Business settings updated successfully'
        });
        
    } catch (error) {
        console.error('Update business settings error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update business settings',
            error: error.message
        });
    }
});

// GET /api/settings/security - Get security settings
router.get('/security', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('preferences');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Default security settings (these would be stored in user preferences in a real app)
        const securitySettings = {
            biometric: user.preferences?.biometric ?? false,
            autoLock: user.preferences?.autoLock ?? true,
            lockTimeout: user.preferences?.lockTimeout || 5,
            twoFactor: user.preferences?.twoFactor ?? false,
            sessionTimeout: user.preferences?.sessionTimeout || 30
        };

        res.json({
            success: true,
            data: securitySettings
        });
        
    } catch (error) {
        console.error('Get security settings error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get security settings',
            error: error.message
        });
    }
});

// PUT /api/settings/security - Update security settings
router.put('/security', auth, async (req, res) => {
    try {
        const updates = req.body;
        const allowedSettings = [
            'biometric', 'autoLock', 'lockTimeout', 'twoFactor', 'sessionTimeout'
        ];
        
        // Validate required fields
        if (!updates || Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No update data provided'
            });
        }

        // Validate numeric fields
        if (updates.lockTimeout !== undefined && (typeof updates.lockTimeout !== 'number' || updates.lockTimeout < 1 || updates.lockTimeout > 60)) {
            return res.status(400).json({
                success: false,
                message: 'Lock timeout must be a number between 1 and 60 minutes'
            });
        }

        if (updates.sessionTimeout !== undefined && (typeof updates.sessionTimeout !== 'number' || updates.sessionTimeout < 5 || updates.sessionTimeout > 480)) {
            return res.status(400).json({
                success: false,
                message: 'Session timeout must be a number between 5 and 480 minutes'
            });
        }

        // Filter allowed updates
        const filteredUpdates = {};
        Object.keys(updates).forEach(key => {
            if (allowedSettings.includes(key)) {
                filteredUpdates[key] = updates[key];
            }
        });

        // Prepare update query
        const updateQuery = {};
        Object.keys(filteredUpdates).forEach(key => {
            updateQuery[`preferences.${key}`] = filteredUpdates[key];
        });

        const user = await User.findByIdAndUpdate(
            req.user.id,
            { $set: updateQuery },
            { new: true, runValidators: true }
        ).select('preferences');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Return updated security settings
        const securitySettings = {
            biometric: user.preferences?.biometric ?? false,
            autoLock: user.preferences?.autoLock ?? true,
            lockTimeout: user.preferences?.lockTimeout || 5,
            twoFactor: user.preferences?.twoFactor ?? false,
            sessionTimeout: user.preferences?.sessionTimeout || 30
        };

        res.json({
            success: true,
            data: securitySettings,
            message: 'Security settings updated successfully'
        });
        
    } catch (error) {
        console.error('Update security settings error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update security settings',
            error: error.message
        });
    }
});

// GET /api/settings/advanced - Get advanced settings
router.get('/advanced', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('preferences');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Default advanced settings
        const advancedSettings = {
            debugMode: user.preferences?.debugMode ?? false,
            analytics: user.preferences?.analytics ?? true,
            crashReporting: user.preferences?.crashReporting ?? true,
            betaFeatures: user.preferences?.betaFeatures ?? false
        };

        res.json({
            success: true,
            data: advancedSettings
        });
        
    } catch (error) {
        console.error('Get advanced settings error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get advanced settings',
            error: error.message
        });
    }
});

// PUT /api/settings/advanced - Update advanced settings
router.put('/advanced', auth, async (req, res) => {
    try {
        const updates = req.body;
        const allowedSettings = [
            'debugMode', 'analytics', 'crashReporting', 'betaFeatures'
        ];
        
        // Validate required fields
        if (!updates || Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No update data provided'
            });
        }

        // Filter allowed updates
        const filteredUpdates = {};
        Object.keys(updates).forEach(key => {
            if (allowedSettings.includes(key) && typeof updates[key] === 'boolean') {
                filteredUpdates[key] = updates[key];
            }
        });

        // Prepare update query
        const updateQuery = {};
        Object.keys(filteredUpdates).forEach(key => {
            updateQuery[`preferences.${key}`] = filteredUpdates[key];
        });

        const user = await User.findByIdAndUpdate(
            req.user.id,
            { $set: updateQuery },
            { new: true, runValidators: true }
        ).select('preferences');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Return updated advanced settings
        const advancedSettings = {
            debugMode: user.preferences?.debugMode ?? false,
            analytics: user.preferences?.analytics ?? true,
            crashReporting: user.preferences?.crashReporting ?? true,
            betaFeatures: user.preferences?.betaFeatures ?? false
        };

        res.json({
            success: true,
            data: advancedSettings,
            message: 'Advanced settings updated successfully'
        });
        
    } catch (error) {
        console.error('Update advanced settings error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update advanced settings',
            error: error.message
        });
    }
});

module.exports = router;
