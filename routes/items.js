const express = require('express');
const Item = require('../models/Item');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/items - Get all items for user (role-based)
router.get('/', auth, async (req, res) => {
    try {
        const { page = 1, limit = 50, category, search, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
        
        // Build query based on user role
        let query;
        if (req.user.role === 'manager') {
            query = { managerId: req.user.id, isActive: true };
        } else if (req.user.role === 'cashier') {
            // Cashiers should see all items from their manager's inventory
            const User = require('../models/User');
            const cashier = await User.findById(req.user.id);
            if (!cashier || !cashier.managerId) {
                return res.status(400).json({
                    success: false,
                    message: 'Cashier not properly linked to a manager'
                });
            }
            query = { managerId: cashier.managerId, isActive: true };
        } else {
            query = { userId: req.user.id, isActive: true };
        }
        
        if (category) {
            query.category = new RegExp(category, 'i');
        }
        
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { brand: { $regex: search, $options: 'i' } }
            ];
        }
        
        // Execute query with pagination
        console.log('Items query:', JSON.stringify(query, null, 2));
        console.log('User info:', { id: req.user.id, role: req.user.role });
        
        const items = await Item.find(query)
            .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .lean();
        
        console.log(`Found ${items.length} items for user ${req.user.id}`);
        
        // SECURITY: Double-check and filter out any items that don't belong to this user
        const validItems = items.filter(item => {
            let isValid = false;
            
            if (req.user.role === 'manager') {
                isValid = item.managerId?.toString() === req.user.id;
            } else if (req.user.role === 'cashier') {
                // For cashiers, already filtered by managerId in query
                isValid = true;
            } else {
                isValid = item.userId?.toString() === req.user.id;
            }
            
            if (!isValid) {
                console.error(`⚠️  SECURITY: Filtering out item not belonging to user!`);
                console.error(`   - ${item.name} (ID: ${item._id}, managerId: ${item.managerId}, userId: ${item.userId})`);
                console.error(`   - Expected user: ${req.user.id}, role: ${req.user.role}`);
            }
            
            return isValid;
        });
        
        if (items.length !== validItems.length) {
            console.warn(`⚠️  Filtered out ${items.length - validItems.length} unauthorized items`);
        }
        
        // Get total count (only for valid items)
        const total = await Item.countDocuments(query);
        
        res.json({
            success: true,
            data: validItems, // Return only validated items
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
        
    } catch (error) {
        console.error('Get items error:', error);
        res.status(500).json({
            message: 'Failed to get items',
            error: error.message
        });
    }
});

// GET /api/items/categories/list - Get unique categories (role-based)
// NOTE: This route must come BEFORE /:id to avoid being matched as an ID
router.get('/categories/list', auth, async (req, res) => {
    try {
        // Build query based on user role
        let query;
        if (req.user.role === 'manager') {
            query = { managerId: req.user.id, isActive: true };
        } else if (req.user.role === 'cashier') {
            // Cashiers should see categories from their manager's inventory
            const User = require('../models/User');
            const cashier = await User.findById(req.user.id);
            if (!cashier || !cashier.managerId) {
                return res.status(400).json({
                    success: false,
                    message: 'Cashier not properly linked to a manager'
                });
            }
            query = { managerId: cashier.managerId, isActive: true };
        } else {
            query = { userId: req.user.id, isActive: true };
        }

        const categories = await Item.distinct('category', query);
        
        res.json({
            success: true,
            data: categories.sort()
        });
        
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({
            message: 'Failed to get categories',
            error: error.message
        });
    }
});

// GET /api/items/low-stock - Get items with low stock (role-based)
// NOTE: This route must come BEFORE /:id to avoid being matched as an ID
router.get('/low-stock', auth, async (req, res) => {
    try {
        let lowStockItems;
        if (req.user.role === 'manager') {
            lowStockItems = await Item.findLowStockByManager(req.user.id);
        } else if (req.user.role === 'cashier') {
            // Cashiers should see low stock items from their manager's inventory
            const User = require('../models/User');
            const cashier = await User.findById(req.user.id);
            if (!cashier || !cashier.managerId) {
                return res.status(400).json({
                    success: false,
                    message: 'Cashier not properly linked to a manager'
                });
            }
            lowStockItems = await Item.findLowStockByManager(cashier.managerId);
        } else {
            lowStockItems = await Item.findLowStock(req.user.id);
        }
        
        res.json({
            success: true,
            data: lowStockItems,
            count: lowStockItems.length
        });
        
    } catch (error) {
        console.error('Get low stock items error:', error);
        res.status(500).json({
            message: 'Failed to get low stock items',
            error: error.message
        });
    }
});

// GET /api/items/:id - Get single item (role-based)
router.get('/:id', auth, async (req, res) => {
    try {
        // CRITICAL FIX: Find item by ID first, then check access
        // DO NOT filter in query - we need to check manager-cashier relationship
        const item = await Item.findOne({
            _id: req.params.id,
            isActive: true
        });
        
        if (!item) {
            return res.status(404).json({
                success: false,
                message: `Item with ID ${req.params.id} not found`
            });
        }
        
        // Verify access based on manager-cashier relationship
        const User = require('../models/User');
        let hasAccess = false;
        
        if (req.user.role === 'manager') {
            // Manager can access:
            // 1. Items they created
            // 2. Items created by their cashiers
            // 3. Items with managerId matching their id
            const cashiers = await User.find({ managerId: req.user.id }).select('_id');
            const cashierIds = cashiers.map(c => c._id.toString());
            
            hasAccess = 
                item.userId.toString() === req.user.id ||
                item.managerId.toString() === req.user.id ||
                cashierIds.includes(item.userId.toString());
                
            console.log('[Items] Manager access check:', {
                itemId: item._id.toString(),
                itemName: item.name,
                itemUserId: item.userId.toString(),
                itemManagerId: item.managerId.toString(),
                currentUserId: req.user.id,
                cashierIds,
                hasAccess
            });
        } else if (req.user.role === 'cashier') {
            // CRITICAL FIX: Cashier can access:
            // 1. Items they created (item.userId === userId)
            // 2. Items created by their manager (item.userId === managerId)
            // 3. Items with managerId matching their manager (item.managerId === managerId)
            const cashier = await User.findById(req.user.id);
            if (!cashier || !cashier.managerId) {
                return res.status(400).json({
                    success: false,
                    message: 'Cashier not properly linked to a manager'
                });
            }
            const managerId = cashier.managerId.toString();
            
            hasAccess = 
                item.userId.toString() === req.user.id ||
                item.userId.toString() === managerId ||
                item.managerId.toString() === managerId;
                
            console.log('[Items] Cashier access check:', {
                itemId: item._id.toString(),
                itemName: item.name,
                itemUserId: item.userId.toString(),
                itemManagerId: item.managerId.toString(),
                currentUserId: req.user.id,
                currentManagerId: managerId,
                hasAccess,
                check1: item.userId.toString() === req.user.id,
                check2: item.userId.toString() === managerId,
                check3: item.managerId.toString() === managerId
            });
        } else {
            // Fallback: only own items
            hasAccess = item.userId.toString() === req.user.id;
        }
        
        if (!hasAccess) {
            console.error('[Items] Access denied:', {
                itemId: item._id.toString(),
                itemName: item.name,
                userId: req.user.id,
                userRole: req.user.role,
                itemUserId: item.userId.toString(),
                itemManagerId: item.managerId.toString()
            });
            return res.status(403).json({
                success: false,
                message: 'Access denied to this item'
            });
        }
        
        res.json({
            success: true,
            data: item
        });
        
    } catch (error) {
        console.error('Get item error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get item',
            error: error.message
        });
    }
});

// POST /api/items - Create new item (manual entry)
router.post('/', auth, async (req, res) => {
    try {
        console.log('Create item request received:', {
            body: req.body,
            user: req.user ? { id: req.user.id, role: req.user.role } : 'No user',
            headers: req.headers
        });
        
        const {
            name,
            price,
            cost,
            category,
            brand,
            size,
            barcode,
            sku,
            stock,
            minStock,
            deviceId
        } = req.body;
        
        // Validate required fields
        if (!name || !price || !category) {
            console.log('Validation failed:', { name, price, category });
            return res.status(400).json({
                message: 'Name, price, and category are required'
            });
        }
        
        // Check for duplicate SKU if provided
        if (sku) {
            // First determine managerId for SKU validation
            let managerIdForValidation;
            if (req.user.role === 'manager') {
                managerIdForValidation = req.user.id;
            } else if (req.user.role === 'cashier') {
                const User = require('../models/User');
                const cashier = await User.findById(req.user.id);
                if (cashier && cashier.managerId) {
                    managerIdForValidation = cashier.managerId;
                } else {
                    managerIdForValidation = req.user.id; // Fallback
                }
            } else {
                managerIdForValidation = req.user.id;
            }
            
            const existingItem = await Item.findOne({
                sku,
                managerId: managerIdForValidation,
                isActive: true
            });
            
            if (existingItem) {
                console.log('Duplicate SKU found:', { sku, existingItem: existingItem._id, managerId: managerIdForValidation });
                return res.status(400).json({
                    message: 'Item with this SKU already exists'
                });
            }
        }
        
        // Determine managerId and cashierId based on user role
        let managerId, cashierId;
        if (req.user.role === 'manager') {
            managerId = req.user.id;
            cashierId = null;
        } else if (req.user.role === 'cashier') {
            const User = require('../models/User');
            const cashier = await User.findById(req.user.id);
            if (!cashier || !cashier.managerId) {
                console.log('Cashier not properly linked:', { 
                    cashierId: req.user.id, 
                    cashier: cashier ? { managerId: cashier.managerId } : 'Not found' 
                });
                return res.status(400).json({
                    message: 'Cashier not properly linked to a manager'
                });
            }
            managerId = cashier.managerId;
            cashierId = req.user.id;
        } else {
            managerId = req.user.id;
            cashierId = null;
        }

        // Create new item
        const item = new Item({
            name: name.trim(),
            price: parseFloat(price),
            cost: cost ? parseFloat(cost) : 0,
            category: category.trim(),
            brand: brand?.trim(),
            size: size?.trim(),
            barcode: barcode?.trim(),
            sku: sku?.trim(),
            stock: stock ? parseInt(stock) : 0,
            minStock: minStock ? parseInt(minStock) : 0,
            userId: req.user.id,
            managerId,
            cashierId,
            deviceId: deviceId || 'manual-entry'
        });
        
        await item.save();
        
        res.status(201).json({
            success: true,
            data: item,
            message: 'Item created successfully'
        });
        
    } catch (error) {
        console.error('Create item error:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        res.status(500).json({
            success: false,
            message: 'Failed to create item',
            error: error.message
        });
    }
});

// PUT /api/items/:id - Update item
router.put('/:id', auth, async (req, res) => {
    try {
        const updates = req.body;
        const allowedUpdates = [
            'name', 'price', 'cost', 'category', 'brand',
            'size', 'barcode', 'sku', 'stock', 'minStock'
        ];
        
        // Filter allowed updates
        const filteredUpdates = {};
        Object.keys(updates).forEach(key => {
            if (allowedUpdates.includes(key) && updates[key] !== undefined) {
                filteredUpdates[key] = updates[key];
            }
        });
        
        // Check for duplicate SKU if updating SKU
        if (filteredUpdates.sku) {
            // Determine managerId for SKU validation
            let managerIdForValidation;
            if (req.user.role === 'manager') {
                managerIdForValidation = req.user.id;
            } else if (req.user.role === 'cashier') {
                const User = require('../models/User');
                const cashier = await User.findById(req.user.id);
                if (cashier && cashier.managerId) {
                    managerIdForValidation = cashier.managerId;
                } else {
                    managerIdForValidation = req.user.id; // Fallback
                }
            } else {
                managerIdForValidation = req.user.id;
            }
            
            const existingItem = await Item.findOne({
                sku: filteredUpdates.sku,
                managerId: managerIdForValidation,
                isActive: true,
                _id: { $ne: req.params.id }
            });
            
            if (existingItem) {
                return res.status(400).json({
                    success: false,
                    message: 'Item with this SKU already exists'
                });
            }
        }
        
        // Build query based on user role
        let query;
        if (req.user.role === 'manager') {
            query = { _id: req.params.id, managerId: req.user.id, isActive: true };
        } else if (req.user.role === 'cashier') {
            // Cashiers should be able to update items from their manager's inventory
            const User = require('../models/User');
            const cashier = await User.findById(req.user.id);
            if (!cashier || !cashier.managerId) {
                console.log('❌ [Update Item] Cashier not properly linked:', {
                    cashierId: req.user.id,
                    hasCashier: !!cashier,
                    managerId: cashier?.managerId
                });
                return res.status(400).json({
                    success: false,
                    message: 'Cashier not properly linked to a manager'
                });
            }
            query = { _id: req.params.id, managerId: cashier.managerId, isActive: true };
        } else {
            query = { _id: req.params.id, userId: req.user.id, isActive: true };
        }

        const item = await Item.findOneAndUpdate(
            query,
            filteredUpdates,
            { new: true, runValidators: true }
        );
        
        if (!item) {
            console.log('❌ [Update Item] Item not found:', {
                itemId: req.params.id,
                userId: req.user.id,
                role: req.user.role
            });
            return res.status(404).json({
                success: false,
                message: 'Item not found'
            });
        }
        
        console.log('✅ [Update Item] Item updated successfully:', item._id);
        res.json({
            success: true,
            data: item,
            message: 'Item updated successfully'
        });
        
    } catch (error) {
        console.error('Update item error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update item',
            error: error.message
        });
    }
});

// DELETE /api/items/:id - Delete item (soft delete, role-based)
router.delete('/:id', auth, async (req, res) => {
    try {
        // Build query based on user role
        let query;
        if (req.user.role === 'manager') {
            query = { _id: req.params.id, managerId: req.user.id, isActive: true };
        } else if (req.user.role === 'cashier') {
            // Cashiers should be able to delete items from their manager's inventory
            const User = require('../models/User');
            const cashier = await User.findById(req.user.id);
            if (!cashier || !cashier.managerId) {
                return res.status(400).json({
                    success: false,
                    message: 'Cashier not properly linked to a manager'
                });
            }
            query = { _id: req.params.id, managerId: cashier.managerId, isActive: true };
        } else {
            query = { _id: req.params.id, userId: req.user.id, isActive: true };
        }

        const item = await Item.findOneAndUpdate(
            query,
            { isActive: false },
            { new: true }
        );
        
        if (!item) {
            return res.status(404).json({
                message: 'Item not found'
            });
        }
        
        res.json({
            success: true,
            message: 'Item deleted successfully'
        });
        
    } catch (error) {
        console.error('Delete item error:', error);
        res.status(500).json({
            message: 'Failed to delete item',
            error: error.message
        });
    }
});

// POST /api/items/:id/stock - Update stock quantity
router.post('/:id/stock', auth, async (req, res) => {
    try {
        const { quantity, operation = 'set' } = req.body; // operation: 'set', 'add', 'subtract'
        
        if (quantity === undefined || quantity < 0) {
            return res.status(400).json({
                message: 'Valid quantity is required'
            });
        }
        
        // Build query based on user role
        let query;
        if (req.user.role === 'manager') {
            query = { _id: req.params.id, managerId: req.user.id, isActive: true };
        } else if (req.user.role === 'cashier') {
            // Cashiers should be able to update stock for their manager's inventory
            const User = require('../models/User');
            const cashier = await User.findById(req.user.id);
            if (!cashier || !cashier.managerId) {
                return res.status(400).json({
                    success: false,
                    message: 'Cashier not properly linked to a manager'
                });
            }
            query = { _id: req.params.id, managerId: cashier.managerId, isActive: true };
        } else {
            query = { _id: req.params.id, userId: req.user.id, isActive: true };
        }

        const item = await Item.findOne(query);
        
        if (!item) {
            return res.status(404).json({
                message: 'Item not found'
            });
        }
        
        // Update stock based on operation
        switch (operation) {
            case 'add':
                item.stock += parseInt(quantity);
                break;
            case 'subtract':
                item.stock = Math.max(0, item.stock - parseInt(quantity));
                break;
            case 'set':
            default:
                item.stock = parseInt(quantity);
                break;
        }
        
        await item.save();
        
        res.json({
            success: true,
            data: item,
            message: 'Stock updated successfully'
        });
        
    } catch (error) {
        console.error('Update stock error:', error);
        res.status(500).json({
            message: 'Failed to update stock',
            error: error.message
        });
    }
});

// GET /api/items/search/:query - Search items
router.get('/search/:query', auth, async (req, res) => {
    try {
        const { query } = req.params;
        const { limit = 20 } = req.query;
        
        if (!query || query.trim().length < 2) {
            return res.status(400).json({
                message: 'Search query must be at least 2 characters long'
            });
        }
        
        let items;
        if (req.user.role === 'manager') {
            items = await Item.searchItemsByManager(req.user.id, query.trim())
                .limit(parseInt(limit));
        } else if (req.user.role === 'cashier') {
            // Cashiers should search their manager's inventory
            const User = require('../models/User');
            const cashier = await User.findById(req.user.id);
            if (!cashier || !cashier.managerId) {
                return res.status(400).json({
                    success: false,
                    message: 'Cashier not properly linked to a manager'
                });
            }
            items = await Item.searchItemsByManager(cashier.managerId, query.trim())
                .limit(parseInt(limit));
        } else {
            items = await Item.searchItems(req.user.id, query.trim())
                .limit(parseInt(limit));
        }
        
        console.log('Search results:', items.map(item => ({ id: item._id, name: item.name })));
        
        res.json({
            success: true,
            data: items,
            count: items.length
        });
        
    } catch (error) {
        console.error('Search items error:', error);
        res.status(500).json({
            message: 'Failed to search items',
            error: error.message
        });
    }
});

module.exports = router;
