const nodemailer = require('nodemailer');
require('dotenv').config();

class EmailNotifications {
    constructor() {
        this.transporter = nodemailer.createTransport({
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
            console.log('📧 Email not configured - booking confirmation skipped');
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
            
            console.log('✅ Booking confirmation emails sent');
            return { success: true };
            
        } catch (error) {
            console.error('❌ Failed to send booking confirmation:', error);
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
            console.log('✅ Payment notification sent');
            return { success: true };
            
        } catch (error) {
            console.error('❌ Failed to send payment notification:', error);
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
            console.log(`✅ System alert sent: ${alertType}`);
            return { success: true };
            
        } catch (error) {
            console.error('❌ Failed to send system alert:', error);
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
            console.log('✅ Test email sent successfully');
            return { success: true };
            
        } catch (error) {
            console.error('❌ Email test failed:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = EmailNotifications;