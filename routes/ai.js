const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const Item = require('../models/Item');
const auth = require('../middleware/auth');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
        files: 1
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

// Ensure uploads directory exists
const ensureUploadsDir = async () => {
    const uploadsDir = path.join(__dirname, '../../uploads');
    try {
        await fs.access(uploadsDir);
    } catch (error) {
        await fs.mkdir(uploadsDir, { recursive: true });
    }
    return uploadsDir;
};

// Image preprocessing for better OCR results
const preprocessImage = async (buffer) => {
    return await sharp(buffer)
        .greyscale()
        .normalize()
        .sharpen()
        .png()
        .toBuffer();
};

// Extract text using OCR
const extractTextFromImage = async (imageBuffer) => {
    try {
        const processedImage = await preprocessImage(imageBuffer);
        
        const { data } = await Tesseract.recognize(processedImage, 'eng', {
            logger: m => console.log(m)
        });
        
        return {
            text: data.text,
            confidence: data.confidence,
            words: data.words.map(word => ({
                text: word.text,
                confidence: word.confidence,
                bbox: word.bbox
            }))
        };
    } catch (error) {
        console.error('OCR Error:', error);
        throw new Error('Failed to extract text from image');
    }
};

// Parse extracted text to identify item information
const parseItemInfo = (ocrResult) => {
    const text = ocrResult.text.toLowerCase();
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    
    const itemInfo = {
        name: '',
        brand: '',
        size: '',
        price: null,
        expiryDate: null,
        confidence: ocrResult.confidence / 100
    };
    
    // Price detection patterns
    const pricePatterns = [
        /\$(\d+\.?\d*)/g,
        /(\d+\.?\d*)\s*usd/gi,
        /price[:\s]*\$?(\d+\.?\d*)/gi,
        /(\d+\.?\d*)\s*dollars?/gi
    ];
    
    // Date patterns for expiry
    const datePatterns = [
        /exp[iry]*[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
        /best\s*by[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
        /use\s*by[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
        /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/g
    ];
    
    // Size patterns
    const sizePatterns = [
        /(\d+\.?\d*)\s*(oz|ml|l|kg|g|lb|lbs|fl oz|fluid oz)/gi,
        /(\d+\.?\d*)\s*(ounce|ounces|gram|grams|kilogram|kilograms|liter|liters|milliliter|milliliters|pound|pounds)/gi
    ];
    
    // Brand detection (common brand keywords)
    const brandKeywords = [
        'coca-cola', 'pepsi', 'nestle', 'unilever', 'procter', 'johnson',
        'kraft', 'general mills', 'kellogg', 'mars', 'mondelez'
    ];
    
    // Extract price
    for (const pattern of pricePatterns) {
        const matches = text.match(pattern);
        if (matches) {
            const priceMatch = matches[0].match(/(\d+\.?\d*)/);
            if (priceMatch) {
                itemInfo.price = parseFloat(priceMatch[1]);
                break;
            }
        }
    }
    
    // Extract expiry date
    for (const pattern of datePatterns) {
        const matches = text.match(pattern);
        if (matches) {
            try {
                const dateStr = matches[0].replace(/exp[iry]*[:\s]*/gi, '')
                                         .replace(/best\s*by[:\s]*/gi, '')
                                         .replace(/use\s*by[:\s]*/gi, '');
                const parsedDate = new Date(dateStr);
                if (!isNaN(parsedDate.getTime())) {
                    itemInfo.expiryDate = parsedDate;
                    break;
                }
            } catch (error) {
                console.log('Date parsing error:', error);
            }
        }
    }
    
    // Extract size
    for (const pattern of sizePatterns) {
        const matches = text.match(pattern);
        if (matches) {
            itemInfo.size = matches[0].trim();
            break;
        }
    }
    
    // Extract brand
    for (const brand of brandKeywords) {
        if (text.includes(brand.toLowerCase())) {
            itemInfo.brand = brand;
            break;
        }
    }
    
    // Extract item name (use the first substantial line that's not price/date/size)
    for (const line of lines) {
        const cleanLine = line.trim();
        if (cleanLine.length > 3 && 
            !pricePatterns.some(p => p.test(cleanLine)) &&
            !datePatterns.some(p => p.test(cleanLine)) &&
            !sizePatterns.some(p => p.test(cleanLine))) {
            itemInfo.name = cleanLine;
            break;
        }
    }
    
    // If no name found, use the longest line
    if (!itemInfo.name && lines.length > 0) {
        itemInfo.name = lines.reduce((a, b) => a.length > b.length ? a : b);
    }
    
    return itemInfo;
};

// POST /api/ai/extract-item - Extract item information from image
router.post('/extract-item', auth, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No image file provided' });
        }
        
        console.log('Processing image for OCR...');
        
        // Save image temporarily
        const uploadsDir = await ensureUploadsDir();
        const filename = `${uuidv4()}.png`;
        const filepath = path.join(uploadsDir, filename);
        
        // Process and save image
        const processedBuffer = await preprocessImage(req.file.buffer);
        await fs.writeFile(filepath, processedBuffer);
        
        // Extract text using OCR
        const ocrResult = await extractTextFromImage(req.file.buffer);
        
        // Parse item information
        const itemInfo = parseItemInfo(ocrResult);
        
        // Clean up temporary file
        try {
            await fs.unlink(filepath);
        } catch (error) {
            console.log('Error cleaning up temp file:', error);
        }
        
        res.json({
            success: true,
            data: {
                extractedInfo: itemInfo,
                rawText: ocrResult.text,
                confidence: ocrResult.confidence,
                words: ocrResult.words
            }
        });
        
    } catch (error) {
        console.error('AI extraction error:', error);
        res.status(500).json({
            message: 'Failed to extract item information',
            error: error.message
        });
    }
});

// POST /api/ai/create-item - Create item from AI-extracted data
router.post('/create-item', auth, async (req, res) => {
    try {
        const {
            name,
            price,
            category,
            brand,
            size,
            expiryDate,
            aiExtracted,
            aiConfidence,
            extractedData,
            deviceId
        } = req.body;
        
        // Validate required fields
        if (!name || !price || !category) {
            return res.status(400).json({
                message: 'Name, price, and category are required'
            });
        }
        
        // Create new item
        const item = new Item({
            name: name.trim(),
            price: parseFloat(price),
            category: category.trim(),
            brand: brand?.trim(),
            size: size?.trim(),
            expiryDate: expiryDate ? new Date(expiryDate) : null,
            aiExtracted: aiExtracted || false,
            aiConfidence: aiConfidence || 0,
            extractedData: extractedData || null,
            userId: req.user.id,
            deviceId: deviceId || 'unknown'
        });
        
        await item.save();
        
        res.status(201).json({
            success: true,
            data: item,
            message: 'Item created successfully'
        });
        
    } catch (error) {
        console.error('Create item error:', error);
        res.status(500).json({
            message: 'Failed to create item',
            error: error.message
        });
    }
});

// GET /api/ai/suggestions - Get AI-powered item suggestions
router.get('/suggestions', auth, async (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query || query.trim().length < 2) {
            return res.status(400).json({
                message: 'Query must be at least 2 characters long'
            });
        }
        
        // Search existing items for suggestions
        const suggestions = await Item.searchItems(req.user.id, query.trim());
        
        // Limit to top 10 suggestions
        const limitedSuggestions = suggestions.slice(0, 10);
        
        res.json({
            success: true,
            data: limitedSuggestions,
            count: limitedSuggestions.length
        });
        
    } catch (error) {
        console.error('Suggestions error:', error);
        res.status(500).json({
            message: 'Failed to get suggestions',
            error: error.message
        });
    }
});

// Error handling middleware for multer
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                message: 'File too large. Maximum size is 10MB.'
            });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                message: 'Too many files. Only one file is allowed.'
            });
        }
    }
    
    if (error.message === 'Only image files are allowed') {
        return res.status(400).json({
            message: 'Only image files are allowed'
        });
    }
    
    next(error);
});

module.exports = router;
