const express = require('express');
const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const Transaction = require('../models/Transaction');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/finance/dashboard - Get financial dashboard data
router.get('/dashboard', auth, async (req, res) => {
    try {
        const { period = '30' } = req.query; // days
        const days = parseInt(period);
        
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        
        // Get sales summary - now returns totalRevenue (paidAmount)
        const salesSummary = await Sale.getSalesReport(req.user.id, startDate, endDate);
        
        // Get financial summary from transactions
        const financialSummary = await Transaction.getFinancialSummary(req.user.id, startDate, endDate);
        
        // Get top selling items
        const topItems = await Sale.getTopItems(req.user.id, startDate, endDate, 5);
        
        // Format financial summary
        const income = financialSummary.find(item => item._id === 'income') || { total: 0, count: 0, average: 0 };
        const expenses = financialSummary.find(item => item._id === 'expense') || { total: 0, count: 0, average: 0 };
        const profit = income.total - expenses.total;
        
        // Calculate previous period for comparison
        const prevStartDate = new Date(startDate);
        prevStartDate.setDate(prevStartDate.getDate() - days);
        const prevEndDate = new Date(startDate);
        
        const prevSalesSummary = await Sale.getSalesReport(req.user.id, prevStartDate, prevEndDate);
        const prevFinancialSummary = await Transaction.getFinancialSummary(req.user.id, prevStartDate, prevEndDate);
        
        const prevIncome = prevFinancialSummary.find(item => item._id === 'income') || { total: 0 };
        const prevExpenses = prevFinancialSummary.find(item => item._id === 'expense') || { total: 0 };
        const prevProfit = prevIncome.total - prevExpenses.total;
        
        // Calculate growth percentages
        const calculateGrowth = (current, previous) => {
            if (previous === 0) return current > 0 ? 100 : 0;
            return ((current - previous) / previous) * 100;
        };
        
        // Use revenue (paidAmount) for sales calculations
        const currentRevenue = salesSummary[0]?.totalRevenue || salesSummary[0]?.totalSales || 0;
        const prevRevenue = prevSalesSummary[0]?.totalRevenue || prevSalesSummary[0]?.totalSales || 0;
        
        const dashboard = {
            period: {
                days,
                startDate,
                endDate
            },
            sales: {
                total: currentRevenue, // Use actual revenue (paidAmount)
                totalRevenue: currentRevenue, // Explicit revenue field
                transactions: salesSummary[0]?.totalTransactions || 0,
                average: salesSummary[0]?.averageTransaction || 0,
                items: salesSummary[0]?.totalItems || 0,
                growth: calculateGrowth(currentRevenue, prevRevenue)
            },
            finance: {
                income: income.total,
                expenses: expenses.total,
                profit,
                profitMargin: income.total > 0 ? (profit / income.total) * 100 : 0,
                growth: {
                    income: calculateGrowth(income.total, prevIncome.total),
                    expenses: calculateGrowth(expenses.total, prevExpenses.total),
                    profit: calculateGrowth(profit, prevProfit)
                }
            },
            topItems: topItems.map(item => ({
                name: item.itemName,
                quantity: item.totalQuantity,
                revenue: item.totalRevenue
            }))
        };
        
        res.json({
            success: true,
            data: dashboard
        });
        
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({
            message: 'Failed to get dashboard data',
            error: error.message
        });
    }
});

// GET /api/finance/dashboard/home - Get home screen dashboard data
router.get('/dashboard/home', auth, async (req, res) => {
    try {
        console.log('📊 Dashboard home request - User:', req.user.id, 'Role:', req.user.role);
        
        // Set up date ranges
        const today = new Date();
        const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        startOfToday.setHours(0, 0, 0, 0);
        const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
        
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
        startOfYesterday.setHours(0, 0, 0, 0);
        const endOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);
        
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        const endOfWeek = new Date(today);
        endOfWeek.setDate(today.getDate() + (6 - today.getDay()));
        endOfWeek.setHours(23, 59, 59, 999);
        
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        startOfMonth.setHours(0, 0, 0, 0);
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
        
        console.log('📅 Date Ranges:');
        console.log('   Today:', startOfToday.toISOString(), 'to', endOfToday.toISOString());
        
        // Build user filter - for managers: all sales under management, for cashiers: own sales
        let userFilter = {};
        try {
            const userId = new mongoose.Types.ObjectId(req.user.id);
            if (req.user.role === 'manager') {
                userFilter = { managerId: userId };
            } else {
                userFilter = {
                    $or: [
                        { userId: userId },
                        { cashierId: userId }
                    ]
                };
            }
        } catch (error) {
            console.error('❌ Error creating ObjectId, using string:', error.message);
            if (req.user.role === 'manager') {
                userFilter = { managerId: req.user.id };
            } else {
                userFilter = {
                    $or: [
                        { userId: req.user.id },
                        { cashierId: req.user.id }
                    ]
                };
            }
        }
        
        // TODAY'S SALES AGGREGATION - Simple and direct
        // This is the core calculation that sums ALL paidAmount values
        const todaySalesMatch = {
            ...userFilter,
            saleDate: { $gte: startOfToday, $lte: endOfToday }
        };
        
        console.log('🔍 Today Sales Match:', JSON.stringify(todaySalesMatch, null, 2));
        
        const todaySales = await Sale.aggregate([
            {
                $match: todaySalesMatch
            },
            {
                $group: {
                    _id: null,
                    // Sum of ALL paidAmount values - this is what we display (500 + 6000 = 6500)
                    totalRevenue: { $sum: { $ifNull: ['$paidAmount', 0] } },
                    // Sum of all transaction totals (for reference)
                    totalSales: { $sum: { $ifNull: ['$total', 0] } },
                    // Count transactions
                    totalTransactions: { $sum: 1 },
                    // Sum items
                    totalItems: { $sum: { $sum: { $ifNull: ['$items.quantity', 0] } } },
                    // Calculate outstanding (total - paidAmount) for each transaction
                    totalOutstanding: {
                        $sum: {
                            $max: [
                                0,
                                {
                                    $subtract: [
                                        { $ifNull: ['$total', 0] },
                                        { $ifNull: ['$paidAmount', 0] }
                                    ]
                                }
                            ]
                        }
                    },
                    // Count partial payments
                    partialPaymentsCount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $gt: [{ $ifNull: ['$paidAmount', 0] }, 0] },
                                        { $lt: [{ $ifNull: ['$paidAmount', 0] }, { $ifNull: ['$total', 0] }] }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]);
        
        // Get today's revenue - this is the sum of ALL paidAmount values
        const todayRevenue = todaySales[0]?.totalRevenue || 0;
        const todayTotalSales = todaySales[0]?.totalSales || 0;
        
        console.log('💰 TODAY\'S REVENUE CALCULATION:');
        console.log('   Total Revenue (sum of all paidAmount):', todayRevenue);
        console.log('   Total Sales (sum of all totals):', todayTotalSales);
        console.log('   Outstanding:', todaySales[0]?.totalOutstanding || 0);
        console.log('   Partial Payments:', todaySales[0]?.partialPaymentsCount || 0);
        console.log('   Transactions:', todaySales[0]?.totalTransactions || 0);
        
        // Verify: Query all transactions to manually verify the sum
        const allTodayTransactions = await Sale.find(todaySalesMatch)
            .select('receiptNumber total paidAmount paymentStatus saleDate')
            .lean();
        
        const manualSum = allTodayTransactions.reduce((sum, tx) => {
            return sum + (Number(tx.paidAmount) || 0);
        }, 0);
        
        console.log('   Manual verification sum:', manualSum);
        console.log('   Transactions found:', allTodayTransactions.length);
        
        if (Math.abs(todayRevenue - manualSum) > 0.01) {
            console.log('⚠️ WARNING: Aggregation and manual sum differ!');
            console.log('   Using aggregation result:', todayRevenue);
        }
        
        // List all transactions for debugging
        allTodayTransactions.forEach((tx, idx) => {
            console.log(`   ${idx + 1}. ${tx.receiptNumber}: paidAmount=${tx.paidAmount}, total=${tx.total}, status=${tx.paymentStatus}`);
        });
        
        // YESTERDAY'S SALES
        const yesterdaySalesMatch = {
            ...userFilter,
            saleDate: { $gte: startOfYesterday, $lte: endOfYesterday }
        };
        
        const yesterdaySales = await Sale.aggregate([
            { $match: yesterdaySalesMatch },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: { $ifNull: ['$paidAmount', 0] } },
                    totalSales: { $sum: { $ifNull: ['$total', 0] } },
                    totalTransactions: { $sum: 1 }
                }
            }
        ]);
        
        // WEEK'S SALES
        const weekSalesMatch = {
            ...userFilter,
            saleDate: { $gte: startOfWeek, $lte: endOfWeek }
        };
        
        const weekSales = await Sale.aggregate([
            { $match: weekSalesMatch },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: { $ifNull: ['$paidAmount', 0] } },
                    totalSales: { $sum: { $ifNull: ['$total', 0] } },
                    totalTransactions: { $sum: 1 }
                }
            }
        ]);
        
        // MONTHLY REVENUE
        const monthlySalesMatch = {
            ...userFilter,
            saleDate: { $gte: startOfMonth, $lte: endOfMonth }
        };
        
        const monthlyRevenue = await Sale.aggregate([
            { $match: monthlySalesMatch },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: { $ifNull: ['$paidAmount', 0] } }
                }
            }
        ]);
        
        // Get inventory data - for managers, include all items under their management; for cashiers, only their own items
        const Item = require('../models/Item');
        const inventoryMatch = req.user.role === 'manager' 
            ? { managerId: req.user.id }
            : { userId: req.user.id };
            
        const lowStockCount = await Item.countDocuments({
            ...inventoryMatch,
            isActive: true,
            $expr: { $lt: ['$stock', '$minStock'] }
        });
        
        // Get categories count - for managers, include all items under their management; for cashiers, only their own items
        const categoriesCount = await Item.distinct('category', {
            ...inventoryMatch,
            isActive: true
        });
        
        // Get total products count - for managers, include all items under their management; for cashiers, only their own items
        const totalProducts = await Item.countDocuments({
            ...inventoryMatch,
            isActive: true
        });
        
        // Get products added this week - for managers, include all items under their management; for cashiers, only their own items
        const productsAddedThisWeek = await Item.countDocuments({
            ...inventoryMatch,
            isActive: true,
            createdAt: { $gte: startOfWeek }
        });
        
        // Get critical stock items (stock <= 2) - for managers, include all items under their management; for cashiers, only their own items
        const criticalStockCount = await Item.countDocuments({
            ...inventoryMatch,
            isActive: true,
            $expr: { $lte: ['$stock', 2] }
        });
        
        // Get pending orders (sales with pending payment) - for managers, include all sales under their management; for cashiers, only their own sales
        const pendingOrdersMatch = req.user.role === 'manager' 
            ? { managerId: req.user.id }
            : { userId: req.user.id };
            
        const pendingOrders = await Sale.countDocuments({
            ...pendingOrdersMatch,
            paymentStatus: 'pending'
        });
        
        const pendingAmount = await Sale.aggregate([
            {
                $match: {
                    ...pendingOrdersMatch,
                    paymentStatus: 'pending'
                }
            },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: '$total' }
                }
            }
        ]);
        
        // Get cashiers data and performance metrics (only for managers)
        let cashiersData = {
            totalCashiers: 0,
            activeCashiers: 0,
            inactiveCashiers: 0,
            topPerformingCashier: null,
            cashierPerformance: [],
            weeklyPerformance: []
        };
        
        if (req.user.role === 'manager') {
            const User = require('../models/User');
            const totalCashiers = await User.countDocuments({
                role: 'cashier',
                managerId: req.user.id
            });
            
            const activeCashiers = await User.countDocuments({
                role: 'cashier',
                managerId: req.user.id,
                isActive: true
            });
            
            // Get cashier performance data for today
            const cashierPerformanceToday = await Sale.aggregate([
                {
                    $match: {
                        managerId: new mongoose.Types.ObjectId(req.user.id),
                        cashierId: { $exists: true },
                        saleDate: { $gte: startOfToday, $lte: endOfToday }
                    }
                },
                {
                    $group: {
                        _id: '$cashierId',
                        totalSales: { $sum: '$total' }, // Keep for reference
                        totalRevenue: { $sum: '$paidAmount' }, // Actual revenue
                        totalTransactions: { $sum: 1 },
                        totalItems: { $sum: { $sum: '$items.quantity' } },
                        averageTransactionValue: { $avg: '$paidAmount' } // Use paidAmount for average
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
                        totalSales: '$totalRevenue', // Use revenue for display
                        totalRevenue: 1,
                        totalTransactions: 1,
                        totalItems: 1,
                        averageTransactionValue: { $round: ['$averageTransactionValue', 2] }
                    }
                },
                {
                    $sort: { totalRevenue: -1 }
                }
            ]);
            
            // Get top performing cashier
            const topPerformingCashier = cashierPerformanceToday.length > 0 ? cashierPerformanceToday[0] : null;
            
            // Get cashier performance for this week
            const cashierPerformanceWeek = await Sale.aggregate([
                {
                    $match: {
                        managerId: new mongoose.Types.ObjectId(req.user.id),
                        cashierId: { $exists: true },
                        saleDate: { $gte: startOfWeek, $lte: endOfWeek }
                    }
                },
                {
                    $group: {
                        _id: '$cashierId',
                        totalSales: { $sum: '$total' }, // Keep for reference
                        totalRevenue: { $sum: '$paidAmount' }, // Actual revenue
                        totalTransactions: { $sum: 1 },
                        totalItems: { $sum: { $sum: '$items.quantity' } }
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
                        totalSales: '$totalRevenue', // Use revenue for display
                        totalRevenue: 1,
                        totalTransactions: 1,
                        totalItems: 1
                    }
                },
                {
                    $sort: { totalRevenue: -1 }
                }
            ]);
            
            cashiersData = {
                totalCashiers,
                activeCashiers,
                inactiveCashiers: totalCashiers - activeCashiers,
                topPerformingCashier,
                cashierPerformance: cashierPerformanceToday,
                weeklyPerformance: cashierPerformanceWeek
            };
        }
        
        // Calculate trends
        const yesterdayRevenue = yesterdaySales[0]?.totalRevenue || 0;
        const weekRevenue = weekSales[0]?.totalRevenue || 0;
        const monthlyRevenueValue = monthlyRevenue[0]?.totalRevenue || 0;
        
        const salesGrowth = yesterdayRevenue > 0 ? 
            ((todayRevenue - yesterdayRevenue) / yesterdayRevenue * 100) : 0;
        
        const dailyAverage = weekRevenue / 7;
        const todayVsAverage = dailyAverage > 0 ? 
            ((todayRevenue - dailyAverage) / dailyAverage * 100) : 0;
        
        console.log('📈 TRENDS:');
        console.log('   Today Revenue:', todayRevenue);
        console.log('   Yesterday Revenue:', yesterdayRevenue);
        console.log('   Week Revenue:', weekRevenue);
        console.log('   Monthly Revenue:', monthlyRevenueValue);
        console.log('   Sales Growth:', salesGrowth.toFixed(2) + '%');
        
        // FINAL RESPONSE DATA
        // Use todayRevenue which is the sum of ALL paidAmount values from database
        const dashboardData = {
            // Today's data - CRITICAL: todayRevenue is sum of ALL paidAmount (500 + 6000 = 6500)
            todaySales: todayRevenue, // This is the actual amount paid (sum of all paidAmount)
            todayTotalSales: todayTotalSales, // Total sales amount (sum of all transaction totals)
            todayAmountPaid: todayRevenue, // Explicit amount paid (same as todaySales)
            todayPaidAmount: todayRevenue, // Alternative field name
            todayOutstanding: todaySales[0]?.totalOutstanding || 0,
            todayPartialPayments: todaySales[0]?.partialPaymentsCount || 0,
            todayTransactions: todaySales[0]?.totalTransactions || 0,
            todayItems: todaySales[0]?.totalItems || 0,
            
            // Yesterday's data
            yesterdaySales: yesterdayRevenue,
            yesterdayTransactions: yesterdaySales[0]?.totalTransactions || 0,
            
            // Weekly data
            weekSales: weekRevenue,
            weekTransactions: weekSales[0]?.totalTransactions || 0,
            
            // Monthly data
            monthlyRevenue: monthlyRevenueValue,
            
            // Product data
            totalProducts,
            productsAddedThisWeek,
            categoriesCount: categoriesCount.length,
            
            // Stock data
            lowStockCount,
            criticalStockCount,
            
            // Orders data
            pendingOrders,
            pendingAmount: pendingAmount[0]?.totalAmount || 0,
            
            // Trends and growth
            salesGrowth: Math.round(salesGrowth * 100) / 100,
            todayVsAverage: Math.round(todayVsAverage * 100) / 100,
            
            // Cashier data
            ...cashiersData
        };
        
        console.log('✅ FINAL RESPONSE DATA:');
        console.log('   todaySales (amount paid):', dashboardData.todaySales);
        console.log('   todayTotalSales:', dashboardData.todayTotalSales);
        console.log('   todayAmountPaid:', dashboardData.todayAmountPaid);
        console.log('   Expected: 6500 (500 + 6000)');
        console.log('   Actual:', dashboardData.todaySales);
        
        if (dashboardData.todaySales !== 6500 && allTodayTransactions.length >= 2) {
            console.log('⚠️ WARNING: Response value does not match expected 6500!');
        }
        
        res.json({
            success: true,
            data: dashboardData
        });
        
    } catch (error) {
        console.error('Home dashboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get home dashboard data',
            error: error.message
        });
    }
});

// GET /api/finance/reports/comprehensive - Get comprehensive reports data
router.get('/reports/comprehensive', auth, async (req, res) => {
    try {
        const { period = 'today', startDate, endDate } = req.query;
        
        let start, end;
        if (startDate && endDate) {
            start = new Date(startDate);
            end = new Date(endDate);
        } else {
            // Set date range based on period
            const now = new Date();
            switch (period) {
                case 'today':
                    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
                    break;
                case 'week':
                    start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    end = now;
                    break;
                case 'month':
                    start = new Date(now.getFullYear(), now.getMonth(), 1);
                    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
                    break;
                case 'year':
                    start = new Date(now.getFullYear(), 0, 1);
                    end = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
                    break;
                default:
                    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                    end = now;
            }
        }
        
        // Build match query based on user role (removed paymentStatus filter to include all sales)
        let salesMatch;
        if (req.user.role === 'manager') {
            salesMatch = { 
                managerId: new mongoose.Types.ObjectId(req.user.id),
                saleDate: { $gte: start, $lte: end }
            };
        } else if (req.user.role === 'cashier') {
            salesMatch = { 
                cashierId: new mongoose.Types.ObjectId(req.user.id),
                saleDate: { $gte: start, $lte: end }
            };
        } else {
            salesMatch = { 
                userId: new mongoose.Types.ObjectId(req.user.id),
                saleDate: { $gte: start, $lte: end }
            };
        }

        // Get sales summary - use paidAmount for actual revenue
        const salesSummary = await Sale.aggregate([
            {
                $match: salesMatch
            },
            {
                $group: {
                    _id: null,
                    totalSales: { $sum: '$total' }, // Keep for reference
                    totalRevenue: { $sum: '$paidAmount' }, // Actual revenue
                    totalOrders: { $sum: 1 },
                    averageOrderValue: { $avg: '$paidAmount' }, // Use paidAmount for average
                    totalItems: { $sum: { $sum: '$items.quantity' } }
                }
            }
        ]);
        
        // Get top products
        const topProducts = await Sale.aggregate([
            {
                $match: salesMatch
            },
            { $unwind: '$items' },
            {
                $lookup: {
                    from: 'items',
                    localField: 'items.item',
                    foreignField: '_id',
                    as: 'itemDetails'
                }
            },
            { $unwind: '$itemDetails' },
            {
                $group: {
                    _id: '$itemDetails._id',
                    name: { $first: '$itemDetails.name' },
                    quantity: { $sum: '$items.quantity' },
                    revenue: { $sum: '$items.subtotal' }
                }
            },
            { $sort: { revenue: -1 } },
            { $limit: 10 }
        ]);
        
        // Get sales by category
        const salesByCategory = await Sale.aggregate([
            {
                $match: salesMatch
            },
            { $unwind: '$items' },
            {
                $lookup: {
                    from: 'items',
                    localField: 'items.item',
                    foreignField: '_id',
                    as: 'itemDetails'
                }
            },
            { $unwind: '$itemDetails' },
            {
                $group: {
                    _id: '$itemDetails.category',
                    amount: { $sum: '$items.subtotal' },
                    quantity: { $sum: '$items.quantity' }
                }
            },
            { $sort: { amount: -1 } }
        ]);
        
        // Get daily sales data - use paidAmount for actual revenue
        const dailySales = await Sale.aggregate([
            {
                $match: salesMatch
            },
            {
                $group: {
                    _id: {
                        year: { $year: '$saleDate' },
                        month: { $month: '$saleDate' },
                        day: { $dayOfMonth: '$saleDate' }
                    },
                    amount: { $sum: '$paidAmount' }, // Actual revenue
                    totalSales: { $sum: '$total' }, // Keep for reference
                    orders: { $sum: 1 }
                }
            },
            {
                $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
            }
        ]);
        
        // Get hourly sales data - use paidAmount for actual revenue
        const hourlySales = await Sale.aggregate([
            {
                $match: salesMatch
            },
            {
                $group: {
                    _id: { $hour: '$saleDate' },
                    amount: { $sum: '$paidAmount' } // Actual revenue
                }
            },
            { $sort: { '_id': 1 } }
        ]);
        
        // Get inventory data
        const Item = require('../models/Item');
        let inventoryMatch;
        if (req.user.role === 'manager') {
            inventoryMatch = { managerId: req.user.id, isActive: true };
        } else {
            inventoryMatch = { userId: req.user.id, isActive: true };
        }

        const inventoryStats = await Item.aggregate([
            { $match: inventoryMatch },
            {
                $group: {
                    _id: null,
                    totalProducts: { $sum: 1 },
                    totalStockValue: { $sum: { $multiply: ['$stock', '$price'] } },
                    lowStockItems: {
                        $sum: {
                            $cond: [{ $lt: ['$stock', '$minStock'] }, 1, 0]
                        }
                    },
                    outOfStockItems: {
                        $sum: {
                            $cond: [{ $eq: ['$stock', 0] }, 1, 0]
                        }
                    }
                }
            }
        ]);

        const inventoryData = inventoryStats[0] || {
            totalProducts: 0,
            totalStockValue: 0,
            lowStockItems: 0,
            outOfStockItems: 0
        };

        // Get cashier activities and performance (only for managers)
        let cashierActivities = {
            totalCashiers: 0,
            activeCashiers: 0,
            topPerformingCashier: null,
            cashierPerformance: [],
            cashierStats: []
        };

        if (req.user.role === 'manager') {
            const User = require('../models/User');
            
            // Get cashier counts
            const totalCashiers = await User.countDocuments({
                role: 'cashier',
                managerId: req.user.id
            });
            
            const activeCashiers = await User.countDocuments({
                role: 'cashier',
                managerId: req.user.id,
                isActive: true
            });

            // Get cashier performance for the selected period - use paidAmount for actual revenue
            const cashierPerformance = await Sale.aggregate([
                {
                    $match: {
                        managerId: new mongoose.Types.ObjectId(req.user.id),
                        cashierId: { $exists: true, $ne: null },
                        saleDate: { $gte: start, $lte: end }
                    }
                },
                {
                    $group: {
                        _id: '$cashierId',
                        totalSales: { $sum: '$total' }, // Keep for reference
                        totalRevenue: { $sum: '$paidAmount' }, // Actual revenue
                        totalTransactions: { $sum: 1 },
                        totalItems: { $sum: { $sum: '$items.quantity' } },
                        averageTransactionValue: { $avg: '$paidAmount' }, // Use paidAmount for average
                        lastActivity: { $max: '$saleDate' }
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
                        totalSales: '$totalRevenue', // Use revenue for display
                        totalRevenue: 1,
                        totalTransactions: 1,
                        totalItems: 1,
                        averageTransactionValue: { $round: ['$averageTransactionValue', 2] },
                        lastActivity: 1,
                        isActive: '$cashier.isActive'
                    }
                },
                {
                    $sort: { totalRevenue: -1 }
                }
            ]);

            // Get top performing cashier
            const topPerformingCashier = cashierPerformance.length > 0 ? cashierPerformance[0] : null;

            // Get daily cashier activity for the period - use paidAmount for actual revenue
            const dailyCashierActivity = await Sale.aggregate([
                {
                    $match: {
                        managerId: new mongoose.Types.ObjectId(req.user.id),
                        cashierId: { $exists: true, $ne: null },
                        saleDate: { $gte: start, $lte: end }
                    }
                },
                {
                    $group: {
                        _id: {
                            year: { $year: '$saleDate' },
                            month: { $month: '$saleDate' },
                            day: { $dayOfMonth: '$saleDate' },
                            cashierId: '$cashierId'
                        },
                        dailySales: { $sum: '$paidAmount' }, // Actual revenue
                        dailyTransactions: { $sum: 1 }
                    }
                },
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id.cashierId',
                        foreignField: '_id',
                        as: 'cashier'
                    }
                },
                {
                    $unwind: '$cashier'
                },
                {
                    $project: {
                        date: {
                            $dateFromParts: {
                                year: '$_id.year',
                                month: '$_id.month',
                                day: '$_id.day'
                            }
                        },
                        cashierId: '$_id.cashierId',
                        cashierName: { $concat: ['$cashier.firstName', ' ', '$cashier.lastName'] },
                        dailySales: 1,
                        dailyTransactions: 1
                    }
                },
                {
                    $sort: { date: -1, dailySales: -1 }
                }
            ]);

            cashierActivities = {
                totalCashiers,
                activeCashiers,
                inactiveCashiers: totalCashiers - activeCashiers,
                topPerformingCashier,
                cashierPerformance,
                dailyActivity: dailyCashierActivity
            };
        }

        // Calculate totals - use revenue (paidAmount) for actual money received
        const summary = salesSummary[0] || {
            totalSales: 0,
            totalRevenue: 0,
            totalOrders: 0,
            averageOrderValue: 0,
            totalItems: 0
        };
        
        const totalSalesByCategory = salesByCategory.reduce((sum, cat) => sum + cat.amount, 0);
        
        // Format response
        const reportData = {
            period: {
                type: period,
                startDate: start,
                endDate: end
            },
            summary: {
                totalSales: summary.totalRevenue || summary.totalSales, // Use revenue (actual money received)
                totalRevenue: summary.totalRevenue || 0, // Explicit revenue field
                totalOrders: summary.totalOrders,
                averageOrderValue: summary.averageOrderValue,
                totalItems: summary.totalItems
            },
            topProducts: topProducts.map(item => ({
                name: item.name,
                quantity: item.quantity,
                revenue: item.revenue,
                growth: 0 // Placeholder for growth calculation
            })),
            salesByCategory: salesByCategory.map(cat => ({
                category: cat._id,
                amount: cat.amount,
                percentage: totalSalesByCategory > 0 ? (cat.amount / totalSalesByCategory) * 100 : 0,
                color: getCategoryColor(cat._id)
            })),
            dailySales: dailySales.map(day => ({
                date: `${day._id.year}-${day._id.month.toString().padStart(2, '0')}-${day._id.day.toString().padStart(2, '0')}`,
                amount: day.amount,
                orders: day.orders
            })),
            hourlySales: hourlySales.map(hour => ({
                hour: `${hour._id.toString().padStart(2, '0')}:00`,
                amount: hour.amount
            })),
            customerInsights: {
                newCustomers: 0, // Placeholder - would need customer tracking
                returningCustomers: 0,
                averageOrderFrequency: 0,
                customerLifetimeValue: 0
            },
            performanceMetrics: {
                conversionRate: 0, // Placeholder
                averageSessionDuration: '0m 0s',
                topSellingTime: hourlySales.length > 0 ? 
                    `${hourlySales.reduce((max, hour) => hour.amount > max.amount ? hour : max)._id}:00` : 'N/A',
                inventoryTurnover: 0 // Placeholder
            },
            inventory: {
                totalProducts: inventoryData.totalProducts,
                totalStockValue: inventoryData.totalStockValue,
                lowStockItems: inventoryData.lowStockItems,
                outOfStockItems: inventoryData.outOfStockItems,
                stockHealth: inventoryData.totalProducts > 0 ? 
                    ((inventoryData.totalProducts - inventoryData.lowStockItems - inventoryData.outOfStockItems) / inventoryData.totalProducts * 100) : 0
            },
            cashierActivities
        };
        
        res.json({
            success: true,
            data: reportData
        });
        
    } catch (error) {
        console.error('Comprehensive report error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate comprehensive report',
            error: error.message
        });
    }
});

// Helper function to assign colors to categories
const getCategoryColor = (category) => {
    const colors = [
        '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
        '#06B6D4', '#84CC16', '#F97316', '#EC4899', '#6366F1'
    ];
    const hash = category.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
    }, 0);
    return colors[Math.abs(hash) % colors.length];
};

// GET /api/finance/reports/cashier-daily-sales - Get cashier daily sales report
router.get('/reports/cashier-daily-sales', auth, async (req, res) => {
    try {
        const { date, startDate, endDate, cashierId } = req.query;
        
        // Only managers can access this endpoint
        if (req.user.role !== 'manager') {
            return res.status(403).json({
                success: false,
                message: 'Only managers can access cashier daily sales reports'
            });
        }
        
        // Determine date range
        let start, end;
        if (date) {
            // Single date provided
            const selectedDate = new Date(date);
            start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
            end = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 23, 59, 59);
        } else if (startDate && endDate) {
            // Date range provided
            start = new Date(startDate);
            end = new Date(endDate);
        } else {
            // Default to today
            const today = new Date();
            start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
        }
        
        // Build match query
        const matchQuery = {
            managerId: new mongoose.Types.ObjectId(req.user.id),
            saleDate: { $gte: start, $lte: end }
        };
        
        // Filter by cashier if provided
        if (cashierId) {
            matchQuery.cashierId = new mongoose.Types.ObjectId(cashierId);
        }
        
        // Get all transactions for the date range
        const transactions = await Sale.find(matchQuery)
            .populate('cashierId', 'firstName lastName email username')
            .populate('customerId', 'name phone email')
            .sort({ saleDate: -1 })
            .lean();
        
        // Get all cashiers for lookup (in case some transactions have unpopulated cashierId)
        const User = require('../models/User');
        const allCashiers = await User.find({
            role: 'cashier',
            managerId: req.user.id
        }).select('_id firstName lastName email username').lean();
        
        // Create a cashier lookup map
        const cashierLookup = new Map();
        allCashiers.forEach(cashier => {
            cashierLookup.set(cashier._id.toString(), cashier);
        });
        
        // Group transactions by cashier
        const cashierMap = new Map();
        
        transactions.forEach(transaction => {
            // Handle cashierId - can be ObjectId, populated object, or string
            let cashierId = 'unknown';
            let cashierName = 'Unknown Cashier';
            
            if (transaction.cashierId) {
                if (typeof transaction.cashierId === 'object' && transaction.cashierId._id) {
                    cashierId = transaction.cashierId._id.toString();
                } else if (typeof transaction.cashierId === 'object' && transaction.cashierId.toString) {
                    cashierId = transaction.cashierId.toString();
                } else {
                    cashierId = transaction.cashierId.toString();
                }
            }
            
            // Try to get cashier name from populated object
            if (transaction.cashierId && typeof transaction.cashierId === 'object') {
                const firstName = transaction.cashierId.firstName || '';
                const lastName = transaction.cashierId.lastName || '';
                const email = transaction.cashierId.email || '';
                const username = transaction.cashierId.username || '';
                const name = `${firstName} ${lastName}`.trim();
                cashierName = name || email || username || 'Unknown Cashier';
            } else if (cashierId !== 'unknown' && cashierLookup.has(cashierId)) {
                // Look up cashier from the lookup map
                const cashier = cashierLookup.get(cashierId);
                const firstName = cashier.firstName || '';
                const lastName = cashier.lastName || '';
                const email = cashier.email || '';
                const username = cashier.username || '';
                const name = `${firstName} ${lastName}`.trim();
                cashierName = name || email || username || 'Unknown Cashier';
            }
            
            if (!cashierMap.has(cashierId)) {
                cashierMap.set(cashierId, {
                    cashierId,
                    cashierName,
                    transactions: [],
                    totalSales: 0,
                    totalTransactions: 0,
                    totalItems: 0,
                    partialPayments: 0,
                    outstandingBalance: 0,
                    partialTransactions: []
                });
            }
            
            const cashierData = cashierMap.get(cashierId);
            const totalAmount = transaction.total || 0;
            const paidAmount = transaction.paidAmount || totalAmount; // Use totalAmount as fallback for fully paid
            const itemCount = transaction.items?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;
            const paymentStatus = transaction.paymentStatus || transaction.status || 'completed';
            const isPartial = paymentStatus === 'partial' || paymentStatus === 'pending';
            const outstandingBalance = Math.max(0, totalAmount - paidAmount);
            
            // Add transaction to cashier data - use paidAmount for actual revenue
            cashierData.transactions.push(transaction);
            cashierData.totalSales += paidAmount; // Use paidAmount instead of totalAmount
            cashierData.totalTransactions += 1;
            cashierData.totalItems += itemCount;
            
            // Track partial payments
            if (isPartial && outstandingBalance > 0) {
                cashierData.partialPayments += 1;
                cashierData.outstandingBalance += outstandingBalance;
                
                cashierData.partialTransactions.push({
                    receiptNumber: transaction.receiptNumber || transaction._id?.toString() || 'N/A',
                    customerName: transaction.customerName || transaction.customerId?.name || 'Unknown',
                    total: totalAmount,
                    paidAmount: paidAmount,
                    outstandingBalance: outstandingBalance,
                    date: transaction.saleDate || transaction.createdAt
                });
            }
        });
        
        // Convert map to array and format response
        const cashierSummaries = Array.from(cashierMap.values()).map(cashier => ({
            cashierId: cashier.cashierId,
            cashierName: cashier.cashierName,
            totalSales: cashier.totalSales,
            totalTransactions: cashier.totalTransactions,
            totalItems: cashier.totalItems,
            partialPayments: cashier.partialPayments,
            outstandingBalance: cashier.outstandingBalance,
            partialTransactions: cashier.partialTransactions,
            transactions: cashier.transactions
        })).sort((a, b) => b.totalSales - a.totalSales);
        
        res.json({
            success: true,
            data: {
                date: date || (startDate && endDate ? `${startDate} to ${endDate}` : 'today'),
                startDate: start,
                endDate: end,
                transactions: transactions,
                cashierSummaries: cashierSummaries
            }
        });
        
    } catch (error) {
        console.error('Cashier daily sales error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get cashier daily sales',
            error: error.message
        });
    }
});

// GET /api/finance/reports/sales - Get detailed sales report
router.get('/reports/sales', auth, async (req, res) => {
    try {
        const { startDate, endDate, groupBy = 'day' } = req.query;
        
        if (!startDate || !endDate) {
            return res.status(400).json({
                message: 'Start date and end date are required'
            });
        }
        
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        // Aggregate sales data
        const groupByConfig = {
            day: {
                year: { $year: '$saleDate' },
                month: { $month: '$saleDate' },
                day: { $dayOfMonth: '$saleDate' }
            },
            week: {
                year: { $year: '$saleDate' },
                week: { $week: '$saleDate' }
            },
            month: {
                year: { $year: '$saleDate' },
                month: { $month: '$saleDate' }
            }
        };
        
        const salesReport = await Sale.aggregate([
            {
                $match: {
                    userId: new mongoose.Types.ObjectId(req.user.id),
                    saleDate: { $gte: start, $lte: end }
                }
            },
            {
                $group: {
                    _id: groupByConfig[groupBy] || groupByConfig.day,
                    totalSales: { $sum: '$total' }, // Keep for reference
                    totalRevenue: { $sum: '$paidAmount' }, // Actual revenue
                    totalTransactions: { $sum: 1 },
                    averageTransaction: { $avg: '$paidAmount' }, // Use paidAmount for average
                    totalItems: { $sum: { $sum: '$items.quantity' } },
                    totalTax: { $sum: '$tax' },
                    totalDiscount: { $sum: '$discount' }
                }
            },
            {
                $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
            }
        ]);
        
        // Get payment method breakdown - use paidAmount for actual revenue
        const paymentMethodBreakdown = await Sale.aggregate([
            {
                $match: {
                    userId: new mongoose.Types.ObjectId(req.user.id),
                    saleDate: { $gte: start, $lte: end }
                }
            },
            {
                $group: {
                    _id: '$paymentMethod',
                    total: { $sum: '$paidAmount' }, // Actual revenue
                    count: { $sum: 1 }
                }
            },
            {
                $sort: { total: -1 }
            }
        ]);
        
        // Get category breakdown - use paidAmount for actual revenue
        const categoryBreakdown = await Sale.aggregate([
            {
                $match: {
                    userId: new mongoose.Types.ObjectId(req.user.id),
                    saleDate: { $gte: start, $lte: end }
                }
            },
            { $unwind: '$items' },
            {
                $lookup: {
                    from: 'items',
                    localField: 'items.item',
                    foreignField: '_id',
                    as: 'itemDetails'
                }
            },
            { $unwind: '$itemDetails' },
            {
                $group: {
                    _id: '$itemDetails.category',
                    total: { $sum: '$items.subtotal' },
                    quantity: { $sum: '$items.quantity' },
                    count: { $sum: 1 }
                }
            },
            {
                $sort: { total: -1 }
            }
        ]);
        
        res.json({
            success: true,
            data: {
                period: { startDate: start, endDate: end, groupBy },
                salesData: salesReport.map(item => ({
                    ...item,
                    totalSales: item.totalRevenue || item.totalSales // Use revenue for display
                })),
                paymentMethods: paymentMethodBreakdown,
                categories: categoryBreakdown,
                summary: {
                    totalSales: salesReport.reduce((sum, item) => sum + (item.totalRevenue || item.totalSales), 0), // Use revenue
                    totalRevenue: salesReport.reduce((sum, item) => sum + (item.totalRevenue || 0), 0), // Explicit revenue
                    totalTransactions: salesReport.reduce((sum, item) => sum + item.totalTransactions, 0),
                    totalItems: salesReport.reduce((sum, item) => sum + item.totalItems, 0)
                }
            }
        });
        
    } catch (error) {
        console.error('Sales report error:', error);
        res.status(500).json({
            message: 'Failed to generate sales report',
            error: error.message
        });
    }
});

// POST /api/finance/transactions - Create new transaction (expense/income)
router.post('/transactions', auth, async (req, res) => {
    try {
        const {
            type,
            category,
            amount,
            date,
            paymentMethod,
            reference,
            tags,
            deviceId
        } = req.body;
        
        // Validate required fields
        if (!type || !category || !amount) {
            return res.status(400).json({
                message: 'Type, category, and amount are required'
            });
        }
        
        if (!['income', 'expense'].includes(type)) {
            return res.status(400).json({
                message: 'Type must be either "income" or "expense"'
            });
        }
        
        // Create transaction
        const transaction = new Transaction({
            type,
            category: category.trim(),
            amount: parseFloat(amount),
            date: date ? new Date(date) : new Date(),
            paymentMethod: paymentMethod || 'cash',
            reference: reference?.trim(),
            tags: tags || [],
            userId: req.user.id,
            deviceId: deviceId || 'manual-entry'
        });
        
        await transaction.save();
        
        res.status(201).json({
            success: true,
            data: transaction,
            message: 'Transaction created successfully'
        });
        
    } catch (error) {
        console.error('Create transaction error:', error);
        res.status(500).json({
            message: 'Failed to create transaction',
            error: error.message
        });
    }
});

// GET /api/finance/transactions - Get transactions
router.get('/transactions', auth, async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            type,
            category,
            startDate,
            endDate
        } = req.query;
        
        // Build query
        const query = { userId: req.user.id, isActive: true };
        
        if (type) {
            query.type = type;
        }
        
        if (category) {
            query.category = new RegExp(category, 'i');
        }
        
        if (startDate || endDate) {
            query.date = {};
            if (startDate) {
                query.date.$gte = new Date(startDate);
            }
            if (endDate) {
                query.date.$lte = new Date(endDate);
            }
        }
        
        // Execute query with pagination
        const transactions = await Transaction.find(query)
            .sort({ date: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);
        
        // Get total count
        const total = await Transaction.countDocuments(query);
        
        res.json({
            success: true,
            data: transactions,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
        
    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({
            message: 'Failed to get transactions',
            error: error.message
        });
    }
});

// GET /api/finance/categories - Get expense/income categories
router.get('/categories', auth, async (req, res) => {
    try {
        const { type } = req.query;
        
        const query = { userId: req.user.id, isActive: true };
        if (type) {
            query.type = type;
        }
        
        const categories = await Transaction.distinct('category', query);
        
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

// GET /api/finance/trends - Get financial trends
router.get('/trends', auth, async (req, res) => {
    try {
        const { months = 12 } = req.query;
        
        const monthlyTrend = await Transaction.getMonthlyTrend(req.user.id, parseInt(months));
        
        // Format trend data
        const trendData = {};
        monthlyTrend.forEach(item => {
            const key = `${item._id.year}-${item._id.month.toString().padStart(2, '0')}`;
            if (!trendData[key]) {
                trendData[key] = { income: 0, expense: 0, profit: 0 };
            }
            trendData[key][item._id.type] = item.total;
        });
        
        // Calculate profit for each month
        Object.keys(trendData).forEach(key => {
            trendData[key].profit = trendData[key].income - trendData[key].expense;
        });
        
        res.json({
            success: true,
            data: Object.keys(trendData).sort().map(key => ({
                period: key,
                ...trendData[key]
            }))
        });
        
    } catch (error) {
        console.error('Get trends error:', error);
        res.status(500).json({
            message: 'Failed to get trends',
            error: error.message
        });
    }
});

// DELETE /api/finance/transactions/:id - Delete transaction
router.delete('/transactions/:id', auth, async (req, res) => {
    try {
        const transaction = await Transaction.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id, isActive: true },
            { isActive: false },
            { new: true }
        );
        
        if (!transaction) {
            return res.status(404).json({
                message: 'Transaction not found'
            });
        }
        
        res.json({
            success: true,
            message: 'Transaction deleted successfully'
        });
        
    } catch (error) {
        console.error('Delete transaction error:', error);
        res.status(500).json({
            message: 'Failed to delete transaction',
            error: error.message
        });
    }
});

module.exports = router;
