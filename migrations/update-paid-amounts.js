/**
 * Migration Script: Update paidAmount for existing sales
 * 
 * This script updates all existing sales records to ensure paidAmount is set correctly:
 * - For completed transactions: Set paidAmount = total (if not already set)
 * - For partial transactions: Keep existing paidAmount
 * - For pending transactions: Set paidAmount = 0 (if not already set)
 * 
 * Run this script once to migrate existing data to the new revenue calculation system.
 * 
 * Usage:
 *   node migrations/update-paid-amounts.js
 * 
 * Or with MongoDB connection string:
 *   MONGODB_URI="your-connection-string" node migrations/update-paid-amounts.js
 */

const mongoose = require('mongoose');
const Sale = require('../models/Sale');

// Get MongoDB connection string from environment or use default
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/smartpoint';

async function migratePaidAmounts() {
    try {
        console.log('🔄 Starting paidAmount migration...');
        console.log('📡 Connecting to MongoDB...');
        
        // Connect to MongoDB
        await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        
        console.log('✅ Connected to MongoDB');
        
        // Find all sales that need updating
        const salesToUpdate = await Sale.find({
            $or: [
                { paidAmount: { $exists: false } },
                { paidAmount: null },
                { paidAmount: 0, paymentStatus: 'completed' }
            ]
        });
        
        console.log(`📊 Found ${salesToUpdate.length} sales to update`);
        
        let updatedCount = 0;
        let skippedCount = 0;
        
        for (const sale of salesToUpdate) {
            try {
                let newPaidAmount = sale.paidAmount;
                
                // Determine the correct paidAmount based on payment status
                if (sale.paymentStatus === 'completed') {
                    // For completed transactions, paidAmount should equal total
                    newPaidAmount = sale.total;
                } else if (sale.paymentStatus === 'partial') {
                    // For partial payments, keep existing paidAmount or use 0 if not set
                    newPaidAmount = sale.paidAmount || 0;
                } else if (sale.paymentStatus === 'pending') {
                    // For pending payments, paidAmount should be 0
                    newPaidAmount = 0;
                } else {
                    // For other statuses (refunded, failed), keep existing or set to 0
                    newPaidAmount = sale.paidAmount || 0;
                }
                
                // Only update if the value needs to change
                if (newPaidAmount !== sale.paidAmount) {
                    sale.paidAmount = newPaidAmount;
                    await sale.save();
                    updatedCount++;
                    
                    if (updatedCount % 100 === 0) {
                        console.log(`⏳ Updated ${updatedCount} sales...`);
                    }
                } else {
                    skippedCount++;
                }
            } catch (error) {
                console.error(`❌ Error updating sale ${sale._id}:`, error.message);
            }
        }
        
        console.log('\n✅ Migration completed!');
        console.log(`📈 Summary:`);
        console.log(`   - Updated: ${updatedCount} sales`);
        console.log(`   - Skipped: ${skippedCount} sales (already correct)`);
        console.log(`   - Total processed: ${salesToUpdate.length} sales`);
        
        // Verify the migration
        const completedWithoutPaidAmount = await Sale.countDocuments({
            paymentStatus: 'completed',
            $or: [
                { paidAmount: { $ne: '$total' } },
                { paidAmount: { $exists: false } }
            ]
        });
        
        if (completedWithoutPaidAmount > 0) {
            console.log(`\n⚠️  Warning: ${completedWithoutPaidAmount} completed sales still have incorrect paidAmount`);
        } else {
            console.log('\n✅ All completed sales have correct paidAmount values');
        }
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    } finally {
        // Close MongoDB connection
        await mongoose.connection.close();
        console.log('\n🔌 Disconnected from MongoDB');
        process.exit(0);
    }
}

// Run migration
if (require.main === module) {
    migratePaidAmounts();
}

module.exports = migratePaidAmounts;

