const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const User = require('../models/User');
const auth = require('../middleware/auth');

// GET /api/customers - Get all customers for the manager
router.get('/', auth, async (req, res) => {
    try {
        console.log('Get customers request received:', {
            user: req.user ? { id: req.user.id, role: req.user.role } : 'No user',
            query: req.query
        });

        // Determine managerId
        let managerId;
        if (req.user.role === 'manager') {
            managerId = req.user.id;
        } else if (req.user.role === 'cashier') {
            const cashier = await User.findById(req.user.id);
            if (cashier && cashier.managerId) {
                managerId = cashier.managerId;
            } else {
                return res.status(400).json({
                    message: 'Cashier must be associated with a manager'
                });
            }
        } else {
            return res.status(403).json({
                message: 'Access denied'
            });
        }

        const {
            page = 1,
            limit = 50,
            search,
            customerType,
            sortBy = 'name',
            sortOrder = 'asc'
        } = req.query;

        // Build query
        let query = { managerId, isActive: true };

        // Add search filter
        if (search) {
            const searchRegex = new RegExp(search, 'i');
            query.$or = [
                { name: searchRegex },
                { email: searchRegex },
                { phone: searchRegex },
                { businessName: searchRegex }
            ];
        }

        // Add customer type filter
        if (customerType && ['individual', 'business'].includes(customerType)) {
            query.customerType = customerType;
        }

        // Build sort object
        const sortObj = {};
        sortObj[sortBy] = sortOrder === 'desc' ? -1 : 1;

        // Execute query
        const customers = await Customer.find(query)
            .sort(sortObj)
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .select('-__v');

        // Get total count for pagination
        const total = await Customer.countDocuments(query);

        res.json({
            success: true,
            data: customers,
            pagination: {
                current: parseInt(page),
                pages: Math.ceil(total / limit),
                total: total
            }
        });

    } catch (error) {
        console.error('Get customers error:', error);
        res.status(500).json({
            message: 'Failed to get customers',
            error: error.message
        });
    }
});

// GET /api/customers/search/:term - Search customers
router.get('/search/:term', auth, async (req, res) => {
    try {
        console.log('Search customers request received:', {
            searchTerm: req.params.term,
            user: req.user ? { id: req.user.id, role: req.user.role } : 'No user'
        });

        // Determine managerId
        let managerId;
        if (req.user.role === 'manager') {
            managerId = req.user.id;
        } else if (req.user.role === 'cashier') {
            const cashier = await User.findById(req.user.id);
            if (cashier && cashier.managerId) {
                managerId = cashier.managerId;
            } else {
                return res.status(400).json({
                    message: 'Cashier must be associated with a manager'
                });
            }
        } else {
            return res.status(403).json({
                message: 'Access denied'
            });
        }

        const { limit = 10 } = req.query;
        const searchTerm = req.params.term;

        if (!searchTerm || searchTerm.length < 2) {
            return res.json({
                success: true,
                data: []
            });
        }

        const customers = await Customer.searchCustomers(managerId, searchTerm, {
            limit: parseInt(limit),
            sort: { name: 1 }
        });

        res.json({
            success: true,
            data: customers
        });

    } catch (error) {
        console.error('Search customers error:', error);
        res.status(500).json({
            message: 'Failed to search customers',
            error: error.message
        });
    }
});

// GET /api/customers/:id - Get single customer
router.get('/:id', auth, async (req, res) => {
    try {
        console.log('Get customer request received:', {
            customerId: req.params.id,
            user: req.user ? { id: req.user.id, role: req.user.role } : 'No user'
        });

        // Determine managerId
        let managerId;
        if (req.user.role === 'manager') {
            managerId = req.user.id;
        } else if (req.user.role === 'cashier') {
            const cashier = await User.findById(req.user.id);
            if (cashier && cashier.managerId) {
                managerId = cashier.managerId;
            } else {
                return res.status(400).json({
                    message: 'Cashier must be associated with a manager'
                });
            }
        } else {
            return res.status(403).json({
                message: 'Access denied'
            });
        }

        const customer = await Customer.findOne({
            _id: req.params.id,
            managerId,
            isActive: true
        }).select('-__v');

        if (!customer) {
            return res.status(404).json({
                message: 'Customer not found'
            });
        }

        res.json({
            success: true,
            data: customer
        });

    } catch (error) {
        console.error('Get customer error:', error);
        res.status(500).json({
            message: 'Failed to get customer',
            error: error.message
        });
    }
});

// POST /api/customers - Create new customer
router.post('/', auth, async (req, res) => {
    try {
        console.log('Create customer request received:', {
            body: req.body,
            user: req.user ? { id: req.user.id, role: req.user.role } : 'No user'
        });

        // Determine managerId
        let managerId;
        if (req.user.role === 'manager') {
            managerId = req.user.id;
        } else if (req.user.role === 'cashier') {
            const cashier = await User.findById(req.user.id);
            if (cashier && cashier.managerId) {
                managerId = cashier.managerId;
            } else {
                return res.status(400).json({
                    message: 'Cashier must be associated with a manager'
                });
            }
        } else {
            return res.status(403).json({
                message: 'Access denied'
            });
        }

        const {
            name,
            email,
            phone,
            address,
            dateOfBirth,
            gender,
            customerType,
            businessName,
            businessType,
            taxId,
            notes,
            tags,
            deviceId
        } = req.body;

        // Validate required fields
        if (!name || !phone) {
            return res.status(400).json({
                message: 'Name and phone number are required'
            });
        }

        // Validate email format if provided
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({
                message: 'Invalid email format'
            });
        }

        // Check for duplicate email if provided
        if (email) {
            const existingCustomer = await Customer.findOne({
                email,
                managerId,
                isActive: true
            });

            if (existingCustomer) {
                return res.status(400).json({
                    message: 'Customer with this email already exists'
                });
            }
        }

        // Check for duplicate phone if provided
        if (phone) {
            const existingCustomer = await Customer.findOne({
                phone,
                managerId,
                isActive: true
            });

            if (existingCustomer) {
                return res.status(400).json({
                    message: 'Customer with this phone number already exists'
                });
            }
        }

        // Create customer
        const customer = new Customer({
            name: name.trim(),
            phone: phone.trim(),
            email: email ? email.trim().toLowerCase() : undefined,
            address: address || {},
            dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
            gender: gender || 'prefer_not_to_say',
            customerType: customerType || 'individual',
            businessName: customerType === 'business' ? businessName?.trim() : undefined,
            businessType: customerType === 'business' ? businessType?.trim() : undefined,
            taxId: customerType === 'business' ? taxId?.trim() : undefined,
            notes: notes?.trim(),
            tags: tags || [],
            userId: req.user.id,
            managerId,
            deviceId: deviceId || 'unknown'
        });

        await customer.save();

        res.status(201).json({
            success: true,
            data: customer
        });

    } catch (error) {
        console.error('Create customer error:', error);
        res.status(500).json({
            message: 'Failed to create customer',
            error: error.message
        });
    }
});

// PUT /api/customers/:id - Update customer
router.put('/:id', auth, async (req, res) => {
    try {
        console.log('Update customer request received:', {
            customerId: req.params.id,
            body: req.body,
            user: req.user ? { id: req.user.id, role: req.user.role } : 'No user'
        });

        // Determine managerId
        let managerId;
        if (req.user.role === 'manager') {
            managerId = req.user.id;
        } else if (req.user.role === 'cashier') {
            const cashier = await User.findById(req.user.id);
            if (cashier && cashier.managerId) {
                managerId = cashier.managerId;
            } else {
                return res.status(400).json({
                    message: 'Cashier must be associated with a manager'
                });
            }
        } else {
            return res.status(403).json({
                message: 'Access denied'
            });
        }

        const {
            name,
            email,
            phone,
            address,
            dateOfBirth,
            gender,
            customerType,
            businessName,
            businessType,
            taxId,
            notes,
            tags
        } = req.body;

        // Find customer
        const customer = await Customer.findOne({
            _id: req.params.id,
            managerId,
            isActive: true
        });

        if (!customer) {
            return res.status(404).json({
                message: 'Customer not found'
            });
        }

        // Validate email format if provided
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({
                message: 'Invalid email format'
            });
        }

        // Check for duplicate email if provided and different from current
        if (email && email !== customer.email) {
            const existingCustomer = await Customer.findOne({
                email,
                managerId,
                isActive: true,
                _id: { $ne: req.params.id }
            });

            if (existingCustomer) {
                return res.status(400).json({
                    message: 'Customer with this email already exists'
                });
            }
        }

        // Check for duplicate phone if provided and different from current
        if (phone && phone !== customer.phone) {
            const existingCustomer = await Customer.findOne({
                phone,
                managerId,
                isActive: true,
                _id: { $ne: req.params.id }
            });

            if (existingCustomer) {
                return res.status(400).json({
                    message: 'Customer with this phone number already exists'
                });
            }
        }

        // Update customer
        customer.name = name ? name.trim() : customer.name;
        customer.phone = phone ? phone.trim() : customer.phone;
        customer.email = email ? email.trim().toLowerCase() : customer.email;
        customer.address = address || customer.address;
        customer.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : customer.dateOfBirth;
        customer.gender = gender || customer.gender;
        customer.customerType = customerType || customer.customerType;
        customer.businessName = customerType === 'business' ? businessName?.trim() : undefined;
        customer.businessType = customerType === 'business' ? businessType?.trim() : undefined;
        customer.taxId = customerType === 'business' ? taxId?.trim() : undefined;
        customer.notes = notes?.trim() || customer.notes;
        customer.tags = tags || customer.tags;

        await customer.save();

        res.json({
            success: true,
            data: customer
        });

    } catch (error) {
        console.error('Update customer error:', error);
        res.status(500).json({
            message: 'Failed to update customer',
            error: error.message
        });
    }
});

// DELETE /api/customers/:id - Soft delete customer
router.delete('/:id', auth, async (req, res) => {
    try {
        console.log('Delete customer request received:', {
            customerId: req.params.id,
            user: req.user ? { id: req.user.id, role: req.user.role } : 'No user'
        });

        // Determine managerId
        let managerId;
        if (req.user.role === 'manager') {
            managerId = req.user.id;
        } else if (req.user.role === 'cashier') {
            const cashier = await User.findById(req.user.id);
            if (cashier && cashier.managerId) {
                managerId = cashier.managerId;
            } else {
                return res.status(400).json({
                    message: 'Cashier must be associated with a manager'
                });
            }
        } else {
            return res.status(403).json({
                message: 'Access denied'
            });
        }

        const customer = await Customer.findOne({
            _id: req.params.id,
            managerId,
            isActive: true
        });

        if (!customer) {
            return res.status(404).json({
                message: 'Customer not found'
            });
        }

        // Soft delete
        customer.isActive = false;
        await customer.save();

        res.json({
            success: true,
            message: 'Customer deleted successfully'
        });

    } catch (error) {
        console.error('Delete customer error:', error);
        res.status(500).json({
            message: 'Failed to delete customer',
            error: error.message
        });
    }
});

module.exports = router;
