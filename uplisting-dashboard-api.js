require('dotenv').config();

// Function to get Uplisting dashboard data
async function getUplistingDashboardData() {
    if (!process.env.UPLISTING_API_KEY) {
        return { success: false, error: 'Uplisting not configured' };
    }
    
    const base64ApiKey = Buffer.from(process.env.UPLISTING_API_KEY).toString('base64');
    
    try {
        // Get properties data
        const propertiesResponse = await fetch('https://connect.uplisting.io/properties', {
            headers: {
                'Authorization': `Basic ${base64ApiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!propertiesResponse.ok) {
            throw new Error(`Properties API failed: ${propertiesResponse.status}`);
        }
        
        const propertiesData = await propertiesResponse.json();
        
        // Calculate statistics from properties data
        const totalProperties = propertiesData.data ? propertiesData.data.length : 0;
        
        // Try to get booking data from Uplisting - try different approaches
        let bookingData = { total_bookings: 0, total_revenue: 0, bookings: [] };
        
        // Try the general bookings endpoint first
        try {
            const bookingsResponse = await fetch('https://connect.uplisting.io/bookings?per_page=100', {
                headers: {
                    'Authorization': `Basic ${base64ApiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (bookingsResponse.ok) {
                const bookingsResult = await bookingsResponse.json();
                console.log('✅ Uplisting bookings data:', bookingsResult);
                
                if (bookingsResult.data && Array.isArray(bookingsResult.data)) {
                    bookingData.bookings = bookingsResult.data;
                    bookingData.total_bookings = bookingsResult.data.length;
                    
                    // Calculate total revenue from bookings
                    bookingData.total_revenue = bookingsResult.data.reduce((sum, booking) => {
                        const amount = booking.attributes?.total_amount || booking.attributes?.amount || 0;
                        return sum + (parseFloat(amount) || 0);
                    }, 0);
                }
            } else if (bookingsResponse.status === 429) {
                console.log('⚠️ Uplisting API rate limited (429) - will show property data only');
            } else {
                console.log('📊 Uplisting bookings API response:', bookingsResponse.status);
                
                // Try alternative: get recent bookings from each property
                console.log('🔄 Trying individual property booking data...');
                for (const property of (propertiesData.data || []).slice(0, 2)) { // Limit to 2 to avoid rate limits
                    try {
                        const propBookingsResponse = await fetch(`https://connect.uplisting.io/properties/${property.id}/bookings?per_page=50`, {
                            headers: {
                                'Authorization': `Basic ${base64ApiKey}`,
                                'Content-Type': 'application/json'
                            }
                        });
                        
                        if (propBookingsResponse.ok) {
                            const propBookings = await propBookingsResponse.json();
                            if (propBookings.data && Array.isArray(propBookings.data)) {
                                bookingData.bookings.push(...propBookings.data);
                                bookingData.total_bookings += propBookings.data.length;
                                
                                // Add revenue from this property
                                const propRevenue = propBookings.data.reduce((sum, booking) => {
                                    const amount = booking.attributes?.total_amount || booking.attributes?.amount || 0;
                                    return sum + (parseFloat(amount) || 0);
                                }, 0);
                                bookingData.total_revenue += propRevenue;
                            }
                        }
                        
                        // Small delay to avoid rate limiting
                        await new Promise(resolve => setTimeout(resolve, 500));
                    } catch (propError) {
                        console.log(`Could not fetch bookings for property ${property.id}:`, propError.message);
                    }
                }
            }
        } catch (bookingError) {
            console.log('📊 Could not fetch Uplisting bookings:', bookingError.message);
        }
        
        const dashboardData = {
            success: true,
            total_properties: totalProperties,
            properties: propertiesData.data ? propertiesData.data.map(prop => ({
                id: prop.id,
                name: prop.attributes?.name || 'Unknown',
                bedrooms: prop.attributes?.bedrooms || 0,
                max_capacity: prop.attributes?.maximum_capacity || 0,
                currency: prop.attributes?.currency || 'NZD'
            })) : [],
            // Add real booking data from Uplisting API
            total_bookings: bookingData.total_bookings,
            total_revenue: bookingData.total_revenue,
            bookings: bookingData.bookings,
            message: `Connected to Uplisting - ${totalProperties} properties, ${bookingData.total_bookings} bookings`
        };
        
        return dashboardData;
        
    } catch (error) {
        console.error('❌ Error fetching Uplisting dashboard data:', error);
        return {
            success: false,
            error: error.message,
            total_properties: 0,
            properties: []
        };
    }
}

module.exports = { getUplistingDashboardData };

// Test if run directly
if (require.main === module) {
    getUplistingDashboardData().then(data => {
        console.log('🏨 Uplisting Dashboard Data:');
        console.log(JSON.stringify(data, null, 2));
    });
}