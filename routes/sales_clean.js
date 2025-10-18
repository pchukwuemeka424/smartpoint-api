const express = require('express');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const Item = require('../models/Item');
const auth = require('../middleware/auth');

const router = express.Router();

// Generate unique receipt number
const generateReceiptNumber = () => {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${timestamp}${random}`;
};

// GET /api/sales - Get all sales/transactions
router.get('/', auth, async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 50, 
            sortBy = 'saleDate', 
            sortOrder = 'desc',
            status,
            startDate,
            endDate,
            search,
            cashierId // New parameter for filtering by specific cashier
        } = req.query;
        
        // Build query based on user role
        let query;
        if (req.user.role === 'manager') {
            query = { managerId: req.user.id };
            // If manager wants to see specific cashier's transactions
            if (cashierId) {
                query.cashierId = cashierId;
            }
        } else if (req.user.role === 'cashier') {
            query = { cashierId: req.user.id };
        } else {
            query = { userId: req.user.id };
        }
        
        // Add status filter
        if (status && status !== 'all') {
            query.paymentStatus = status;
        }
        
        // Add date range filter
        if (startDate || endDate) {
            query.saleDate = {};
            if (startDate) {
                query.saleDate.$gte = new Date(startDate);
            }
            if (endDate) {
                query.saleDate.$lte = new Date(endDate);
            }
        }
        
        // Add search filter
        if (search) {
            query.$or = [
                { receiptNumber: { $regex: search, $options: 'i' } },
                { customerName: { $regex: search, $options: 'i' } },
                { customerPhone: { $regex: search, $options: 'i' } }
            ];
        }
        
        // Execute query with pagination
        const sales = await Sale.find(query)
            .populate('items.item', 'name category brand')
            .populate('cashierId', 'firstName lastName username')
            .populate('managerId', 'firstName lastName username')
            .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .lean();
        
        // Get total count
        const total = await Sale.countDocuments(query);
        
        res.json({
            success: true,
            data: sales,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
        
    } catch (error) {
        console.error('Get sales error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get sales',
            error: error.message
        });
    }
});

// GET /api/sales/cashiers - Get all transactions by cashiers (Manager only)
router.get('/cashiers', auth, async (req, res) => {
    try {
        // Only managers can access this endpoint
        if (req.user.role !== 'manager') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Manager role required.'
            });
        }

        const { 
            page = 1, 
            limit = 50, 
            sortBy = 'saleDate', 
            sortOrder = 'desc',
            status,
            startDate,
            endDate,
            search,
            cashierId
        } = req.query;
        
        // Build query for all cashier transactions under this manager
        let query = { 
            managerId: new mongoose.Types.ObjectId(req.user.id),
            cashierId: { $exists: true, $ne: null } // Only transactions made by cashiers
        };
        
        // Filter by specific cashier if provided
        if (cashierId) {
            query.cashierId = new mongoose.Types.ObjectId(cashierId);
        }
        
        // Add status filter
        if (status && status !== 'all') {
            query.paymentStatus = status;
        }
        
        // Add date range filter
        if (startDate || endDate) {
            query.saleDate = {};
            if (startDate) {
                query.saleDate.$gte = new Date(startDate);
            }
            if (endDate) {
                query.saleDate.$lte = new Date(endDate);
            }
        }
        
        // Add search filter
        if (search) {
            query.$or = [
                { receiptNumber: { $regex: search, $options: 'i' } },
                { customerName: { $regex: search, $options: 'i' } },
                { customerPhone: { $regex: search, $options: 'i' } }
            ];
        }
        
        console.log('Cashier transactions query:', JSON.stringify(query, null, 2));
        
        // Execute query with pagination
        let sales = [];
        let total = 0;
        
        try {
            sales = await Sale.find(query)
                .populate('items.item', 'name category brand')
                .populate('cashierId', 'firstName lastName username role')
                .populate('managerId', 'firstName lastName username')
                .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
                .limit(limit * 1)
                .skip((page - 1) * limit)
                .lean();
                
            console.log('Found sales count:', sales.length);
            
            // Get total count
            total = await Sale.countDocuments(query);
        } catch (queryError) {
            console.error('Sales query error:', queryError);
            throw queryError;
        }
        
        // Get cashier statistics
        let cashierStats = [];
        try {
            cashierStats = await Sale.aggregate([
                { $match: { 
                    managerId: new mongoose.Types.ObjectId(req.user.id), 
                    cashierId: { $exists: true, $ne: null } 
                } },
                {
                    $group: {
                        _id: '$cashierId',
                        totalSales: { $sum: '$total' },
                        transactionCount: { $sum: 1 },
                        averageTransaction: { $avg: '$total' }
                    }
                },
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'cashier'
                    }
                },
                {
                    $unwind: '$cashier'
                },
                {
                    $project: {
                        cashierId: '$_id',
                        cashierName: { $concat: ['$cashier.firstName', ' ', '$cashier.lastName'] },
                        totalSales: 1,
                        transactionCount: 1,
                        averageTransaction: { $round: ['$averageTransaction', 2] }
                    }
                },
                { $sort: { totalSales: -1 } }
            ]);
        } catch (aggError) {
            console.error('Cashier stats aggregation error:', aggError);
            // Continue without cashier stats if aggregation fails
            cashierStats = [];
        }
        
        res.json({
            success: true,
            data: sales,
            cashierStats,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
        
    } catch (error) {
        console.error('Get cashier sales error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get cashier sales',
            error: error.message
        });
    }
});

// GET /api/sales/:id - Get specific sale
router.get('/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Build query based on user role
        let query;
        if (req.user.role === 'manager') {
            query = { _id: id, managerId: req.user.id };
        } else if (req.user.role === 'cashier') {
            query = { _id: id, cashierId: req.user.id };
        } else {
            query = { _id: id, userId: req.user.id };
        }
        
        const sale = await Sale.findOne(query)
            .populate('items.item', 'name category brand price')
            .populate('cashierId', 'firstName lastName username')
            .populate('managerId', 'firstName lastName username');
        
        if (!sale) {
            return res.status(404).json({
                success: false,
                message: 'Sale not found'
            });
        }
        
        res.json({
            success: true,
            data: sale
        });
        
    } catch (error) {
        console.error('Get sale error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get sale',
            error: error.message
        });
    }
});

// GET /api/sales/receipt/:receiptNumber - Get sale by receipt number
router.get('/receipt/:receiptNumber', auth, async (req, res) => {
    try {
        const { receiptNumber } = req.params;
        
        // Build query based on user role
        let query;
        if (req.user.role === 'manager') {
            query = { receiptNumber, managerId: req.user.id };
        } else if (req.user.role === 'cashier') {
            query = { receiptNumber, cashierId: req.user.id };
        } else {
            query = { receiptNumber, userId: req.user.id };
        }
        
        const sale = await Sale.findOne(query)
            .populate('items.item', 'name category brand price')
            .populate('cashierId', 'firstName lastName username')
            .populate('managerId', 'firstName lastName username');
        
        if (!sale) {
            return res.status(404).json({
                success: false,
                message: 'Sale not found'
            });
        }
        
        res.json({
            success: true,
            data: sale
        });
        
    } catch (error) {
        console.error('Get sale by receipt error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get sale',
            error: error.message
        });
    }
});

// GET /api/sales/daily/:date - Get daily sales
router.get('/daily/:date', auth, async (req, res) => {
    try {
        const { date } = req.params;
        const targetDate = new Date(date);
        const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
        const endOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59);
        
        // Build query based on user role
        let query;
        if (req.user.role === 'manager') {
            query = { 
                managerId: req.user.id,
                saleDate: { $gte: startOfDay, $lte: endOfDay }
            };
        } else if (req.user.role === 'cashier') {
            query = { 
                cashierId: req.user.id,
                saleDate: { $gte: startOfDay, $lte: endOfDay }
            };
        } else {
            query = { 
                userId: req.user.id,
                saleDate: { $gte: startOfDay, $lte: endOfDay }
            };
        }
        
        const sales = await Sale.find(query)
            .populate('items.item', 'name category brand')
            .populate('cashierId', 'firstName lastName username')
            .sort({ saleDate: -1 });
        
        // Calculate summary
        const summary = sales.reduce((acc, sale) => {
            acc.totalSales += sale.total;
            acc.totalTransactions += 1;
            acc.totalItems += sale.items.reduce((sum, item) => sum + item.quantity, 0);
            return acc;
        }, { totalSales: 0, totalTransactions: 0, totalItems: 0 });
        
        res.json({
            success: true,
            data: {
                sales,
                summary,
                date: targetDate
            }
        });
        
    } catch (error) {
        console.error('Get daily sales error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get daily sales',
            error: error.message
        });
    }
});

// POST /api/sales/checkout - Create new sale (checkout)
router.post('/checkout', auth, async (req, res) => {
    try {
        const {
            items,
            total,
            paidAmount,
            change,
            paymentMethod = 'cash',
            cashierId,
            receiptNumber,
            // Legacy fields for backward compatibility
            tax = 0,
            discount = 0,
            customerName,
            customerPhone,
            customerEmail,
            notes,
            deviceId
        } = req.body;
        
        // Validate items
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                message: 'At least one item is required'
            });
        }
        
        // Validate required fields
        if (total === undefined || paidAmount === undefined) {
            return res.status(400).json({
                message: 'Total and paidAmount are required'
            });
        }
        
        // Validate and process each item
        const saleItems = [];
        let calculatedSubtotal = 0;
        
        console.log('Processing items:', items);
        console.log('User ID:', req.user.id);
        
        for (const saleItem of items) {
            const { productId, name, price, quantity, subtotal } = saleItem;
            
            console.log('Processing item:', { productId, name, price, quantity, subtotal });
            console.log('ProductId type:', typeof productId);
            console.log('ProductId length:', productId?.length);
            console.log('Is valid ObjectId?', mongoose.Types.ObjectId.isValid(productId));
            
            if (!productId || !quantity || quantity <= 0) {
                console.log('Validation failed: missing productId or invalid quantity');
                return res.status(400).json({
                    message: 'Each item must have valid productId and quantity'
                });
            }
            
            // Validate productId is a valid MongoDB ObjectId
            if (!mongoose.Types.ObjectId.isValid(productId)) {
                console.log('Invalid ObjectId:', productId);
                return res.status(400).json({
                    message: `Invalid product ID format: ${productId}`
                });
            }
            
            // Get item details from database
            const item = await Item.findOne({
                _id: productId,
                userId: req.user.id,
                isActive: true
            });
            
            console.log('Found item:', item);
            
            if (!item) {
                console.log('Item not found in database');
                return res.status(404).json({
                    message: `Item with ID ${productId} not found`
                });
            }
            
            // Check stock availability
            if (item.stock < quantity) {
                return res.status(400).json({
                    message: `Insufficient stock for item "${item.name}". Available: ${item.stock}, Requested: ${quantity}`
                });
            }
            
            // Use provided price or item price
            const itemPrice = price || item.price;
            const itemSubtotal = subtotal || (itemPrice * quantity);
            
            saleItems.push({
                item: item._id,
                name: name || item.name,
                price: itemPrice,
                quantity,
                subtotal: itemSubtotal
            });
            
            calculatedSubtotal += itemSubtotal;
            
            // Update item stock
            item.stock -= quantity;
            await item.save();
        }
        
        // Determine managerId and cashierId based on user role
        let managerId, finalCashierId;
        if (req.user.role === 'manager') {
            managerId = req.user.id;
            finalCashierId = cashierId || null;
        } else if (req.user.role === 'cashier') {
            // For cashiers, get their managerId from their user record
            const User = require('../models/User');
            const cashier = await User.findById(req.user.id);
            if (!cashier || !cashier.managerId) {
                return res.status(400).json({
                    message: 'Cashier not properly linked to a manager'
                });
            }
            managerId = cashier.managerId;
            finalCashierId = req.user.id;
        }

        // Calculate totals
        const finalTotal = total || calculatedSubtotal;
        const finalPaidAmount = paidAmount || 0;
        const finalChange = change || Math.max(0, finalPaidAmount - finalTotal);
        
        // Determine payment status
        let paymentStatus = 'completed';
        if (finalPaidAmount < finalTotal) {
            paymentStatus = 'partial';
        } else if (finalPaidAmount === 0) {
            paymentStatus = 'pending';
        }

        // Create sale record
        const sale = new Sale({
            receiptNumber: receiptNumber || generateReceiptNumber(),
            items: saleItems,
            subtotal: calculatedSubtotal,
            total: finalTotal,
            tax: parseFloat(tax) || 0,
            discount: parseFloat(discount) || 0,
            paymentMethod,
            paidAmount: finalPaidAmount,
            change: finalChange,
            paymentStatus,
            customerName: customerName?.trim(),
            customerPhone: customerPhone?.trim(),
            customerEmail: customerEmail?.trim(),
            notes: notes?.trim(),
            userId: req.user.id,
            managerId,
            cashierId: finalCashierId,
            deviceId: deviceId || 'mobile-app',
            saleDate: new Date()
        });
        
        await sale.save();
        
        // Populate item details for response
        await sale.populate('items.item', 'name category brand');
        await sale.populate('cashierId', 'firstName lastName role');
        await sale.populate('managerId', 'firstName lastName role');
        
        const response = {
            success: true,
            data: sale,
            message: 'Transaction completed successfully'
        };
        
        console.log('Sending checkout response:', response);
        
        res.status(201).json(response);
        
    } catch (error) {
        console.error('Checkout error:', error);
        res.status(500).json({
            message: 'Checkout failed',
            error: error.message
        });
    }
});

// PUT /api/sales/:id/refund - Refund a sale
router.put('/:id/refund', auth, async (req, res) => {
    try {
        const { reason } = req.body;
        
        // Build query based on user role
        let query = { 
            _id: req.params.id,
            paymentStatus: 'completed'
        };
        if (req.user.role === 'manager') {
            query.managerId = req.user.id;
        } else if (req.user.role === 'cashier') {
            query.cashierId = req.user.id;
        } else {
            query.userId = req.user.id;
        }

        const sale = await Sale.findOne(query);
        
        if (!sale) {
            return res.status(404).json({
                message: 'Sale not found or cannot be refunded'
            });
        }
        
        // Update sale status
        sale.paymentStatus = 'refunded';
        sale.notes = sale.notes ? `${sale.notes}\nRefund Reason: ${reason}` : `Refund Reason: ${reason}`;
        await sale.save();
        
        // Restore item stock
        for (const saleItem of sale.items) {
            const item = await Item.findById(saleItem.item);
            if (item) {
                item.stock += saleItem.quantity;
                await item.save();
            }
        }
        
        res.json({
            success: true,
            data: sale,
            message: 'Sale refunded successfully'
        });
        
    } catch (error) {
        console.error('Refund sale error:', error);
        res.status(500).json({
            message: 'Failed to refund sale',
            error: error.message
        });
    }
});

// POST /api/sales/bulk-sync - Sync offline sales
router.post('/bulk-sync', auth, async (req, res) => {
    try {
        const { sales } = req.body;
        
        if (!sales || !Array.isArray(sales)) {
            return res.status(400).json({
                message: 'Sales array is required'
            });
        }
        
        const syncResults = {
            success: [],
            failed: [],
            duplicates: []
        };
        
        for (const saleData of sales) {
            try {
                // Check if sale already exists
                const existingSale = await Sale.findOne({
                    receiptNumber: saleData.receiptNumber,
                    userId: req.user.id
                });
                
                if (existingSale) {
                    syncResults.duplicates.push({
                        receiptNumber: saleData.receiptNumber,
                        reason: 'Sale already exists'
                    });
                    continue;
                }
                
                // Create new sale
                const sale = new Sale({
                    ...saleData,
                    userId: req.user.id,
                    syncStatus: 'synced',
                    isOffline: false
                });
                
                await sale.save();
                syncResults.success.push(sale.receiptNumber);
                
            } catch (error) {
                syncResults.failed.push({
                    receiptNumber: saleData.receiptNumber,
                    error: error.message
                });
            }
        }
        
        res.json({
            success: true,
            data: syncResults,
            message: `Synced ${syncResults.success.length} sales successfully`
        });
        
    } catch (error) {
        console.error('Bulk sync error:', error);
        res.status(500).json({
            message: 'Failed to sync sales',
            error: error.message
        });
    }
});

module.exports = router;
