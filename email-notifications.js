const nodemailer = require('nodemailer');
require('dotenv').config();
const { logger } = require('./logger');

class EmailNotifications {
    constructor(transporter = null) {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            logger.warn('⚠️ Email credentials not configured (EMAIL_USER/EMAIL_PASS). Email notifications will be disabled.');
        }

        this.transporter = transporter || nodemailer.createTransport({
            host: process.env.EMAIL_HOST || 'smtp.gmail.com',
            port: process.env.EMAIL_PORT || 587,
            secure: false,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        this.adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
        this.fromEmail = process.env.EMAIL_USER;
    }
    
    async sendBookingConfirmation(booking) {
        if (!this.transporter || !this.fromEmail) {
            logger.warn('📧 Email not configured - booking confirmation skipped');
            return { success: false, reason: 'Email not configured' };
        }
        
        try {
            const guestEmail = {
                from: this.fromEmail,
                to: booking.guest_email,
                subject: `Booking Confirmation - Lakeside Retreat (${booking.accommodation})`,
                html: `
                    <h2>🏡 Booking Confirmed - Lakeside Retreat</h2>
                    <p>Hi ${booking.guest_name},</p>
                    <p>Thank you for booking with us! Your reservation is confirmed.</p>
                    
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3>Booking Details</h3>
                        <p><strong>Accommodation:</strong> ${booking.accommodation}</p>
                        <p><strong>Check-in:</strong> ${new Date(booking.check_in).toLocaleDateString('en-NZ')}</p>
                        <p><strong>Check-out:</strong> ${new Date(booking.check_out).toLocaleDateString('en-NZ')}</p>
                        <p><strong>Guests:</strong> ${booking.guests}</p>
                        <p><strong>Total:</strong> $${booking.total_price}</p>
                        ${booking.security_deposit ? `<p><strong>Security Deposit:</strong> $${booking.security_deposit} (Authorization hold - automatically released 48 hours after checkout)</p>` : ''}
                        <p><strong>Booking ID:</strong> ${booking.id}</p>
                    </div>
                    
                    <h3>What's Next?</h3>
                    <ul>
                        <li>We'll send you detailed arrival instructions 24 hours before check-in</li>
                        <li>If you have any questions, reply to this email or call +64-21-368-682</li>
                        <li>Find local recommendations on our website</li>
                    </ul>

                    ${(booking.accommodation === 'dome-pinot' || booking.accommodation === 'dome-rose') ? `
                    <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
                        <p style="margin: 0;"><strong>Please note:</strong> Dome Pinot and Dome Ros\u00e9 are adults-only accommodations. Guests arriving with children will not be accommodated and no refund will be given.</p>
                    </div>
                    ` : ''}

                    <p>We're excited to host you at our solar-powered retreat!</p>
                    <p>Warm regards,<br>Stephen & Sandy<br>Lakeside Retreat</p>
                    
                    <hr>
                    <p><small>96 Smiths Way, Mount Pisa, Cromwell | lakesideretreat.co.nz</small></p>
                `
            };
            
            const adminEmail = {
                from: this.fromEmail,
                to: this.adminEmail,
                subject: `New Booking - ${booking.accommodation} (${booking.guest_name})`,
                html: `
                    <h2>🎉 New Booking Received</h2>
                    
                    <div style="background: #e6f3e6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3>Guest Details</h3>
                        <p><strong>Name:</strong> ${booking.guest_name}</p>
                        <p><strong>Email:</strong> ${booking.guest_email}</p>
                        <p><strong>Phone:</strong> ${booking.guest_phone || 'Not provided'}</p>
                    </div>
                    
                    <div style="background: #f0f8ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3>Booking Details</h3>
                        <p><strong>Accommodation:</strong> ${booking.accommodation}</p>
                        <p><strong>Dates:</strong> ${new Date(booking.check_in).toLocaleDateString('en-NZ')} to ${new Date(booking.check_out).toLocaleDateString('en-NZ')}</p>
                        <p><strong>Guests:</strong> ${booking.guests}</p>
                        <p><strong>Total:</strong> $${booking.total_price}</p>
                        ${booking.security_deposit ? `<p><strong>Security Deposit:</strong> $${booking.security_deposit} (Authorization hold)</p>` : ''}
                        <p><strong>Status:</strong> ${booking.status}</p>
                        <p><strong>Payment:</strong> ${booking.payment_status}</p>
                        <p><strong>Booking ID:</strong> ${booking.id}</p>
                    </div>
                    
                    ${booking.notes ? `
                    <div style="background: #fffacd; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3>Special Notes</h3>
                        <p>${booking.notes}</p>
                    </div>
                    ` : ''}
                    
                    <p><a href="https://lakeside-retreat-staging.onrender.com/admin-dashboard.html">View in Admin Dashboard</a></p>
                `
            };
            
            await Promise.all([
                this.transporter.sendMail(guestEmail),
                this.transporter.sendMail(adminEmail)
            ]);
            
            logger.info('✅ Booking confirmation emails sent');
            return { success: true };
            
        } catch (error) {
            logger.error('❌ Failed to send booking confirmation:', { error: error.message });
            return { success: false, error: error.message };
        }
    }
    
    async sendPreArrivalInstructions(booking) {
        if (!this.transporter || !this.fromEmail) {
            logger.warn('📧 Email not configured - pre-arrival instructions skipped');
            return { success: false, reason: 'Email not configured' };
        }

        try {
            const accommodationName = this.formatAccommodationName(booking.accommodation);
            const checkInDate = new Date(booking.check_in).toLocaleDateString('en-NZ', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });
            const checkOutDate = new Date(booking.check_out).toLocaleDateString('en-NZ', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });

            const isDome = booking.accommodation === 'dome-pinot' || booking.accommodation === 'dome-rose';
            const isCottage = booking.accommodation === 'lakeside-cottage';

            let propertyTips = '';
            if (isDome) {
                propertyTips = `
                    <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #ffc107;">
                        <h4 style="margin-top: 0;">Dome Reminder</h4>
                        <p style="margin-bottom: 0;">Our eco-domes are <strong>adults-only</strong> accommodations. Please ensure your party meets this requirement. Guests arriving with children will not be accommodated and no refund will be given.</p>
                    </div>
                `;
            } else if (isCottage) {
                propertyTips = `
                    <div style="background: #e8f4fd; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #2196F3;">
                        <h4 style="margin-top: 0;">Pet Policy</h4>
                        <p style="margin-bottom: 0;">Pets are welcome at Lakeside Cottage! Please keep them off the furniture and clean up after them on the property. An additional cleaning fee may apply if needed.</p>
                    </div>
                `;
            }

            const email = {
                from: this.fromEmail,
                to: booking.guest_email,
                subject: `Your Arrival Instructions - Lakeside Retreat (${accommodationName})`,
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                            .header { background: #2c5530; color: white; padding: 20px; text-align: center; }
                            .content { padding: 20px; background: #f9f9f9; }
                            .details-box { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
                            .detail-row { display: flex; padding: 8px 0; border-bottom: 1px solid #eee; }
                            .detail-label { font-weight: bold; min-width: 140px; }
                            .bond-notice { background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #17a2b8; }
                            .cta-button { display: inline-block; background: #25D366; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
                            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h1>Your Stay Starts Tomorrow!</h1>
                                <p style="margin: 0;">Lakeside Retreat</p>
                            </div>
                            <div class="content">
                                <p>Hi ${booking.guest_name || 'there'},</p>

                                <p>We're excited to welcome you tomorrow! Here's everything you need for a smooth arrival.</p>

                                <div class="details-box">
                                    <h3 style="margin-top: 0;">Arrival Details</h3>
                                    <p><strong>Address:</strong> 96 Smiths Way, Mount Pisa, Cromwell</p>
                                    <p><strong>Check-in:</strong> ${checkInDate} from 3:00 PM</p>
                                    <p><strong>Check-out:</strong> ${checkOutDate} by 10:00 AM</p>
                                    <p><strong>Accommodation:</strong> ${accommodationName}</p>
                                    <p><strong>Guests:</strong> ${booking.guests}</p>
                                </div>

                                <div class="details-box">
                                    <h3 style="margin-top: 0;">Property Essentials</h3>
                                    <p><strong>WiFi:</strong> Connect to <code>Lakeside_Guest</code></p>
                                    <p><strong>Parking:</strong> Free parking available on-site</p>
                                    <p><strong>Emergency Contact:</strong> <a href="tel:+6421368682">+64 21 368 682</a></p>
                                </div>

                                <div class="bond-notice">
                                    <h4 style="margin-top: 0;">Security Bond</h4>
                                    <p style="margin-bottom: 0;">A <strong>$300 authorization hold</strong> will be placed on your card as a security bond. This is <em>not</em> a charge — it is automatically released after your stay, provided no damage has occurred. You won't need to do anything; the hold drops off your statement automatically.</p>
                                </div>

                                ${propertyTips}

                                <div class="details-box">
                                    <h3 style="margin-top: 0;">Explore the Area</h3>
                                    <p>Central Otago has some incredible dining options! We recommend checking out the local restaurants and wineries in Cromwell and the surrounding area. Ask us for our favourites when you arrive — we love sharing our local picks.</p>
                                </div>

                                <div style="text-align: center; margin: 25px 0;">
                                    <p><strong>Have questions before you arrive?</strong></p>
                                    <a href="https://wa.me/6421368682" class="cta-button">Message Us on WhatsApp</a>
                                </div>

                                <p>We can't wait to host you!</p>
                                <p>Warm regards,<br>Stephen & Sandy<br>Lakeside Retreat</p>
                            </div>
                            <div class="footer">
                                <p>Lakeside Retreat, 96 Smiths Way, Mount Pisa, Cromwell, Central Otago 9310, New Zealand</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `
            };

            await this.transporter.sendMail(email);
            logger.info(`✅ Pre-arrival instructions sent to ${booking.guest_email}`);
            return { success: true };

        } catch (error) {
            logger.error(`❌ Failed to send pre-arrival instructions to ${booking.guest_email}:`, { error: error.message });
            return { success: false, error: error.message };
        }
    }

    formatAccommodationName(accommodation) {
        const names = {
            'dome-pinot': 'Dome Pinot',
            'dome-rose': 'Dome Ros\u00e9',
            'lakeside-cottage': 'Lakeside Cottage'
        };
        return names[accommodation] || accommodation;
    }

    async sendDuringStayCheckin(booking) {
        if (!this.transporter || !this.fromEmail) {
            logger.warn('📧 Email not configured - during-stay check-in skipped');
            return { success: false, reason: 'Email not configured' };
        }

        try {
            const accommodationName = this.formatAccommodationName(booking.accommodation);

            const email = {
                from: this.fromEmail,
                to: booking.guest_email,
                subject: `Welcome to Lakeside Retreat - We hope you're settling in!`,
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                            .header { background: #2c5530; color: white; padding: 20px; text-align: center; }
                            .content { padding: 20px; background: #f9f9f9; }
                            .details-box { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
                            .cta-button { display: inline-block; background: #25D366; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
                            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h1>Welcome to Lakeside Retreat!</h1>
                                <p style="margin: 0;">${accommodationName}</p>
                            </div>
                            <div class="content">
                                <p>Hi ${booking.guest_name || 'there'},</p>

                                <p>We hope you've settled in and are enjoying your stay at ${accommodationName}! We just wanted to check in and make sure everything is perfect for you.</p>

                                <div class="details-box">
                                    <h3 style="margin-top: 0;">A Few Reminders</h3>
                                    <p><strong>Spa & Hot Tub:</strong> Feel free to enjoy the spa/hot tub during your stay — it's a wonderful way to unwind after a day exploring Central Otago.</p>
                                    <p><strong>WiFi:</strong> Connect to <code>Lakeside_Guest</code> — the password is in your welcome guide.</p>
                                    <p><strong>Emergency Contact:</strong> <a href="tel:+6421368682">+64 21 368 682</a></p>
                                </div>

                                <p>If anything isn't quite right or you need anything at all, please don't hesitate to reach out. We're just a message away!</p>

                                <div style="text-align: center; margin: 25px 0;">
                                    <a href="https://wa.me/6421368682" class="cta-button">Message Us on WhatsApp</a>
                                </div>

                                <p>Enjoy your evening!</p>
                                <p>Warm regards,<br>Stephen & Sandy<br>Lakeside Retreat</p>
                            </div>
                            <div class="footer">
                                <p>Lakeside Retreat, 96 Smiths Way, Mount Pisa, Cromwell, Central Otago 9310, New Zealand</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `
            };

            await this.transporter.sendMail(email);
            logger.info(`✅ During-stay check-in email sent to ${booking.guest_email}`);
            return { success: true };

        } catch (error) {
            logger.error(`❌ Failed to send during-stay check-in to ${booking.guest_email}:`, { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async sendCheckoutThankYou(booking) {
        if (!this.transporter || !this.fromEmail) {
            logger.warn('📧 Email not configured - checkout thank-you skipped');
            return { success: false, reason: 'Email not configured' };
        }

        try {
            const accommodationName = this.formatAccommodationName(booking.accommodation);

            // Review links
            const googleReviewUrl = 'https://g.page/r/lakeside-retreat-cromwell/review';
            const airbnbUrl = 'https://www.airbnb.co.nz/users/show/lakesideretreat';

            const email = {
                from: this.fromEmail,
                to: booking.guest_email,
                subject: `Thank you for staying at Lakeside Retreat!`,
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                            .header { background: #2c5530; color: white; padding: 20px; text-align: center; }
                            .content { padding: 20px; background: #f9f9f9; }
                            .details-box { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
                            .review-buttons { text-align: center; margin: 20px 0; }
                            .review-button { display: inline-block; padding: 12px 25px; margin: 5px; text-decoration: none; border-radius: 5px; color: white; }
                            .google { background: #4285f4; }
                            .airbnb { background: #ff5a5f; }
                            .book-direct { background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #2c5530; }
                            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h1>Thank You for Your Stay!</h1>
                                <p style="margin: 0;">Lakeside Retreat</p>
                            </div>
                            <div class="content">
                                <p>Hi ${booking.guest_name || 'there'},</p>

                                <p>Thank you so much for staying with us at ${accommodationName}! We truly hope you had a wonderful time and that Lakeside Retreat felt like a home away from home.</p>

                                <div class="details-box">
                                    <h3 style="margin-top: 0;">Security Bond</h3>
                                    <p style="margin-bottom: 0;">Your security bond authorization hold will be automatically released within <strong>48 hours</strong>. You don't need to do anything — it will drop off your statement on its own.</p>
                                </div>

                                <p>If you enjoyed your stay, we'd love to hear about it! A quick review helps other travellers discover us and means the world to our small family-run retreat.</p>

                                <div class="review-buttons">
                                    <a href="${googleReviewUrl}" class="review-button google">Review on Google</a>
                                    <a href="${airbnbUrl}" class="review-button airbnb">Review on Airbnb</a>
                                </div>

                                <div class="book-direct">
                                    <p style="margin: 0;"><strong>Book direct next time and save 18%!</strong> When you book through our website at <a href="https://lakesideretreat.co.nz">lakesideretreat.co.nz</a>, you skip the platform fees and get the best possible rate. We'd love to welcome you back!</p>
                                </div>

                                <p>Thank you again for choosing Lakeside Retreat. We hope to see you again soon!</p>
                                <p>Warm regards,<br>Stephen & Sandy<br>Lakeside Retreat</p>
                            </div>
                            <div class="footer">
                                <p>Lakeside Retreat, 96 Smiths Way, Mount Pisa, Cromwell, Central Otago 9310, New Zealand</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `
            };

            await this.transporter.sendMail(email);
            logger.info(`✅ Checkout thank-you email sent to ${booking.guest_email}`);
            return { success: true };

        } catch (error) {
            logger.error(`❌ Failed to send checkout thank-you to ${booking.guest_email}:`, { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async sendPaymentFailureNotification(booking) {
        if (!this.transporter || !this.fromEmail) {
            logger.warn('📧 Email not configured - payment failure notification skipped');
            return { success: false, reason: 'Email not configured' };
        }

        try {
            const accommodationName = this.formatAccommodationName(booking.accommodation);

            const email = {
                from: this.fromEmail,
                to: booking.guest_email,
                subject: `Payment Issue — Lakeside Retreat Booking #${booking.id.slice(0, 8)}`,
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                            .header { background: #2c5530; color: white; padding: 20px; text-align: center; }
                            .content { padding: 20px; background: #f9f9f9; }
                            .details-box { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
                            .alert-box { background: #fff3cd; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #ffc107; }
                            .cta-button { display: inline-block; background: #2c5530; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
                            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h1>Payment Issue</h1>
                                <p style="margin: 0;">Lakeside Retreat</p>
                            </div>
                            <div class="content">
                                <p>Hi ${booking.guest_name || 'there'},</p>

                                <p>We noticed that the payment for your booking didn't go through. Don't worry — these things happen, and your booking details are still saved.</p>

                                <div class="alert-box">
                                    <h4 style="margin-top: 0;">What happened?</h4>
                                    <p style="margin-bottom: 0;">Your payment could not be processed. This can happen for a number of reasons, such as insufficient funds, an expired card, or a temporary issue with your bank.</p>
                                </div>

                                <div class="details-box">
                                    <h3 style="margin-top: 0;">Your Booking</h3>
                                    <p><strong>Accommodation:</strong> ${accommodationName}</p>
                                    <p><strong>Check-in:</strong> ${new Date(booking.check_in).toLocaleDateString('en-NZ')}</p>
                                    <p><strong>Check-out:</strong> ${new Date(booking.check_out).toLocaleDateString('en-NZ')}</p>
                                    <p><strong>Guests:</strong> ${booking.guests}</p>
                                    <p><strong>Total:</strong> $${booking.total_price}</p>
                                    <p><strong>Booking ID:</strong> ${booking.id}</p>
                                </div>

                                <p>To complete your reservation, please try your payment again using the link below:</p>

                                <div style="text-align: center; margin: 25px 0;">
                                    <a href="https://lakesideretreat.co.nz/stay.html" class="cta-button">Try Payment Again</a>
                                </div>

                                <p>If you continue to experience issues, please don't hesitate to reach out. We're happy to help you complete your booking.</p>

                                <p>Warm regards,<br>Stephen & Sandy<br>Lakeside Retreat</p>
                            </div>
                            <div class="footer">
                                <p>Lakeside Retreat, 96 Smiths Way, Mount Pisa, Cromwell, Central Otago 9310, New Zealand</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `
            };

            await this.transporter.sendMail(email);
            logger.info(`✅ Payment failure notification sent to ${booking.guest_email}`);
            return { success: true };

        } catch (error) {
            logger.error(`❌ Failed to send payment failure notification to ${booking.guest_email}:`, { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async sendCancellationConfirmation(booking) {
        if (!this.transporter || !this.fromEmail) {
            logger.warn('📧 Email not configured - cancellation confirmation skipped');
            return { success: false, reason: 'Email not configured' };
        }

        try {
            const accommodationName = this.formatAccommodationName(booking.accommodation);
            const checkInDate = new Date(booking.check_in);
            const now = new Date();
            const daysUntilArrival = Math.ceil((checkInDate - now) / (1000 * 60 * 60 * 24));
            const eligibleForRefund = daysUntilArrival >= 14;

            const refundMessage = eligibleForRefund
                ? `<div class="details-box" style="border-left: 4px solid #28a745;">
                       <h4 style="margin-top: 0;">Refund Information</h4>
                       <p style="margin-bottom: 0;">Since you cancelled more than 14 days before your arrival date, you are eligible for a <strong>full refund</strong>. Your refund is being processed and should appear on your statement within 5-10 business days.</p>
                   </div>`
                : `<div class="details-box" style="border-left: 4px solid #dc3545;">
                       <h4 style="margin-top: 0;">Refund Information</h4>
                       <p style="margin-bottom: 0;">As this cancellation was made within 14 days of your arrival date, it is unfortunately non-refundable per our cancellation policy.</p>
                   </div>`;

            const email = {
                from: this.fromEmail,
                to: booking.guest_email,
                subject: 'Booking Cancelled — Lakeside Retreat',
                html: `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                            .header { background: #2c5530; color: white; padding: 20px; text-align: center; }
                            .content { padding: 20px; background: #f9f9f9; }
                            .details-box { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
                            .policy-box { background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #17a2b8; }
                            .cta-button { display: inline-block; background: #2c5530; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
                            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <h1>Booking Cancelled</h1>
                                <p style="margin: 0;">Lakeside Retreat</p>
                            </div>
                            <div class="content">
                                <p>Hi ${booking.guest_name || 'there'},</p>

                                <p>This email confirms that your booking has been cancelled. We're sorry to see you go!</p>

                                <div class="details-box">
                                    <h3 style="margin-top: 0;">Cancelled Booking Details</h3>
                                    <p><strong>Accommodation:</strong> ${accommodationName}</p>
                                    <p><strong>Check-in:</strong> ${new Date(booking.check_in).toLocaleDateString('en-NZ')}</p>
                                    <p><strong>Check-out:</strong> ${new Date(booking.check_out).toLocaleDateString('en-NZ')}</p>
                                    <p><strong>Guests:</strong> ${booking.guests}</p>
                                    <p><strong>Total:</strong> $${booking.total_price}</p>
                                    <p><strong>Booking ID:</strong> ${booking.id}</p>
                                </div>

                                <div class="policy-box">
                                    <h4 style="margin-top: 0;">Cancellation Policy</h4>
                                    <p style="margin-bottom: 0;">Cancellations 14+ days before arrival receive a full refund. Cancellations within 14 days are non-refundable.</p>
                                </div>

                                ${refundMessage}

                                <p>We'd love to welcome you another time. If your plans change, you're always welcome to rebook:</p>

                                <div style="text-align: center; margin: 25px 0;">
                                    <a href="https://lakesideretreat.co.nz/stay.html" class="cta-button">Book Again</a>
                                </div>

                                <p>If you have any questions about your cancellation or refund, please don't hesitate to get in touch.</p>

                                <p>Warm regards,<br>Stephen & Sandy<br>Lakeside Retreat</p>
                            </div>
                            <div class="footer">
                                <p>Lakeside Retreat, 96 Smiths Way, Mount Pisa, Cromwell, Central Otago 9310, New Zealand</p>
                            </div>
                        </div>
                    </body>
                    </html>
                `
            };

            await this.transporter.sendMail(email);
            logger.info(`✅ Cancellation confirmation sent to ${booking.guest_email}`);
            return { success: true };

        } catch (error) {
            logger.error(`❌ Failed to send cancellation confirmation to ${booking.guest_email}:`, { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async sendPaymentNotification(booking, paymentDetails) {
        if (!this.transporter || !this.fromEmail) {
            return { success: false, reason: 'Email not configured' };
        }
        
        try {
            const email = {
                from: this.fromEmail,
                to: this.adminEmail,
                subject: `Payment Received - ${booking.guest_name} (${booking.accommodation})`,
                html: `
                    <h2>💳 Payment Confirmed</h2>
                    
                    <div style="background: #e6ffe6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3>Payment Details</h3>
                        <p><strong>Amount:</strong> $${booking.total_price}</p>
                        <p><strong>Payment Method:</strong> ${paymentDetails.method || 'Stripe'}</p>
                        <p><strong>Transaction ID:</strong> ${paymentDetails.transactionId || booking.stripe_payment_id}</p>
                        <p><strong>Status:</strong> Completed</p>
                    </div>
                    
                    <div style="background: #f0f8ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3>Booking Details</h3>
                        <p><strong>Guest:</strong> ${booking.guest_name}</p>
                        <p><strong>Accommodation:</strong> ${booking.accommodation}</p>
                        <p><strong>Dates:</strong> ${new Date(booking.check_in).toLocaleDateString('en-NZ')} to ${new Date(booking.check_out).toLocaleDateString('en-NZ')}</p>
                        <p><strong>Booking ID:</strong> ${booking.id}</p>
                    </div>
                    
                    <p>Booking is now fully confirmed and paid.</p>
                `
            };
            
            await this.transporter.sendMail(email);
            logger.info('✅ Payment notification sent');
            return { success: true };
            
        } catch (error) {
            logger.error('❌ Failed to send payment notification:', { error: error.message });
            return { success: false, error: error.message };
        }
    }
    
    async sendSystemAlert(alertType, message, details = {}) {
        if (!this.transporter || !this.fromEmail) {
            return { success: false, reason: 'Email not configured' };
        }
        
        const alertIcons = {
            error: '🚨',
            warning: '⚠️',
            info: 'ℹ️',
            success: '✅'
        };
        
        const alertColors = {
            error: '#ffebee',
            warning: '#fff8e1',
            info: '#e3f2fd',
            success: '#e8f5e8'
        };
        
        try {
            const email = {
                from: this.fromEmail,
                to: this.adminEmail,
                subject: `${alertIcons[alertType] || '📢'} Lakeside Retreat System Alert - ${alertType.toUpperCase()}`,
                html: `
                    <h2>${alertIcons[alertType] || '📢'} System Alert</h2>
                    
                    <div style="background: ${alertColors[alertType] || '#f5f5f5'}; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3>Alert Details</h3>
                        <p><strong>Type:</strong> ${alertType.toUpperCase()}</p>
                        <p><strong>Time:</strong> ${new Date().toLocaleString('en-NZ')}</p>
                        <p><strong>Message:</strong> ${message}</p>
                    </div>
                    
                    ${Object.keys(details).length > 0 ? `
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3>Additional Details</h3>
                        ${Object.entries(details).map(([key, value]) => 
                            `<p><strong>${key}:</strong> ${value}</p>`
                        ).join('')}
                    </div>
                    ` : ''}
                    
                    <p>This is an automated alert from your Lakeside Retreat monitoring system.</p>
                    
                    <hr>
                    <p><small>Lakeside Retreat System Monitor</small></p>
                `
            };
            
            await this.transporter.sendMail(email);
            logger.info(`✅ System alert sent: ${alertType}`);
            return { success: true };
            
        } catch (error) {
            logger.error('❌ Failed to send system alert:', { error: error.message });
            return { success: false, error: error.message };
        }
    }
    
    async testEmailConfiguration() {
        if (!this.transporter || !this.fromEmail) {
            return { success: false, reason: 'Email not configured' };
        }
        
        try {
            const testEmail = {
                from: this.fromEmail,
                to: this.fromEmail,
                subject: 'Lakeside Retreat - Email Test',
                html: `
                    <h2>📧 Email Configuration Test</h2>
                    <p>This is a test email to verify your email configuration.</p>
                    <p><strong>Timestamp:</strong> ${new Date().toLocaleString('en-NZ')}</p>
                    <p>If you received this email, your email notifications are working correctly!</p>
                    
                    <div style="background: #e8f5e8; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3>Configuration Details</h3>
                        <p><strong>Host:</strong> ${process.env.EMAIL_HOST || 'smtp.gmail.com'}</p>
                        <p><strong>Port:</strong> ${process.env.EMAIL_PORT || 587}</p>
                        <p><strong>User:</strong> ${this.fromEmail}</p>
                        <p><strong>Admin Email:</strong> ${this.adminEmail}</p>
                    </div>
                    
                    <p>Email notifications are ready for production!</p>
                `
            };
            
            await this.transporter.sendMail(testEmail);
            logger.info('✅ Test email sent successfully');
            return { success: true };
            
        } catch (error) {
            logger.error('❌ Email test failed:', { error: error.message });
            return { success: false, error: error.message };
        }
    }
}

module.exports = EmailNotifications;