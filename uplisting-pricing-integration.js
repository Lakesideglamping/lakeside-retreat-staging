require('dotenv').config();

async function getUplistingRealPricing() {
    console.log('💰 Getting REAL Uplisting Pricing Data\n');
    
    if (!process.env.UPLISTING_API_KEY) {
        console.log('❌ UPLISTING_API_KEY not found in environment');
        return null;
    }
    
    const base64ApiKey = Buffer.from(process.env.UPLISTING_API_KEY).toString('base64');
    
    try {
        // Get properties with all pricing-related data included
        const response = await fetch('https://connect.uplisting.io/properties?include=fees,taxes,discounts', {
            headers: {
                'Authorization': `Basic ${base64ApiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }
        
        const data = await response.json();
        
        console.log('✅ Properties data retrieved successfully!\n');
        
        // Extract pricing information
        const properties = {};
        
        // Process main property data
        data.data.forEach(property => {
            properties[property.id] = {
                id: property.id,
                name: property.attributes.name,
                currency: property.attributes.currency,
                maximum_capacity: property.attributes.maximum_capacity,
                fees: {},
                taxes: {},
                discounts: {}
            };
        });
        
        // Process included data for fees, taxes, discounts
        if (data.included) {
            data.included.forEach(item => {
                const propertyId = item.id.split('-')[0];
                
                if (properties[propertyId]) {
                    if (item.type === 'property_fees') {
                        properties[propertyId].fees[item.attributes.label] = {
                            name: item.attributes.name,
                            amount: item.attributes.amount,
                            enabled: item.attributes.enabled,
                            guests_included: item.attributes.guests_included
                        };
                    } else if (item.type === 'property_taxes') {
                        properties[propertyId].taxes[item.attributes.label] = {
                            name: item.attributes.name,
                            type: item.attributes.type,
                            per: item.attributes.per,
                            amount: item.attributes.amount
                        };
                    } else if (item.type === 'property_discounts') {
                        properties[propertyId].discounts[item.attributes.label] = {
                            name: item.attributes.name,
                            type: item.attributes.type,
                            days: item.attributes.days,
                            amount: item.attributes.amount
                        };
                    }
                }
            });
        }
        
        // Display pricing information
        console.log('🏡 UPLISTING PRICING BREAKDOWN:\n');
        
        Object.values(properties).forEach(property => {
            console.log(`📍 ${property.name} (ID: ${property.id})`);
            console.log('=' + '='.repeat(50));
            console.log(`Currency: ${property.currency}`);
            console.log(`Max Capacity: ${property.maximum_capacity}`);
            
            console.log('\n💵 FEES:');
            Object.entries(property.fees).forEach(([_key, fee]) => {
                if (fee.enabled) {
                    console.log(`  ${fee.name}: $${fee.amount} ${property.currency}`);
                    if (fee.guests_included !== null) {
                        console.log(`    (Included for ${fee.guests_included} guests)`);
                    }
                }
            });
            
            console.log('\n📊 TAXES:');
            Object.entries(property.taxes).forEach(([_key, tax]) => {
                if (tax.amount > 0) {
                    console.log(`  ${tax.name}: ${tax.type === 'percentage' ? tax.amount + '%' : '$' + tax.amount} per ${tax.per}`);
                }
            });
            
            console.log('\n🎯 DISCOUNTS:');
            Object.entries(property.discounts).forEach(([_key, discount]) => {
                if (discount.amount > 0) {
                    console.log(`  ${discount.name}: ${discount.amount}% off for ${discount.days}+ days`);
                }
            });
            
            console.log('\n');
        });
        
        return properties;
        
    } catch (error) {
        console.error('❌ Failed to get Uplisting pricing:', error.message);
        return null;
    }
}

// Note: Uplisting API doesn't expose nightly rates through public API
// Base rates are managed internally by Uplisting
// This function extracts fees, taxes, and discounts which ARE available
async function checkForRatesAPI() {
    console.log('\n🔍 Checking if Uplisting exposes nightly rates...\n');
    
    const base64ApiKey = Buffer.from(process.env.UPLISTING_API_KEY).toString('base64');
    
    // Try different potential rate endpoints
    const endpoints = [
        'https://connect.uplisting.io/rates',
        'https://connect.uplisting.io/pricing',
        'https://connect.uplisting.io/calendars',
        'https://connect.uplisting.io/availability',
        'https://connect.uplisting.io/rate_plans'
    ];
    
    for (const endpoint of endpoints) {
        try {
            console.log(`Testing: ${endpoint}`);
            const response = await fetch(endpoint, {
                headers: {
                    'Authorization': `Basic ${base64ApiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log(`✅ ${endpoint} - SUCCESS!`);
                console.log(`  Data type: ${typeof data}`);
                if (data.data && Array.isArray(data.data)) {
                    console.log(`  Records: ${data.data.length}`);
                }
            } else {
                console.log(`❌ ${endpoint} - ${response.status} ${response.statusText}`);
            }
        } catch (error) {
            console.log(`❌ ${endpoint} - Error: ${error.message}`);
        }
    }
}

// CLI usage
if (require.main === module) {
    getUplistingRealPricing().then(() => {
        checkForRatesAPI();
    });
}

module.exports = { getUplistingRealPricing, checkForRatesAPI };