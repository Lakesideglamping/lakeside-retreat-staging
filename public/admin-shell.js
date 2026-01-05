/**
 * Admin Shell - Unified Navigation System
 * This script injects a consistent sidebar navigation into all admin pages
 */

(function() {
    'use strict';

    // Navigation configuration
    const navConfig = {
        sections: [
            {
                title: 'Overview',
                items: [
                    { id: 'dashboard', label: 'Dashboard', icon: '📊', href: '/admin-dashboard.html' },
                    { id: 'analytics', label: 'Analytics', icon: '📈', href: '/admin-analytics.html' }
                ]
            },
            {
                title: 'Operations',
                items: [
                    { id: 'bookings', label: 'Bookings', icon: '📅', href: '/admin-bookings.html' },
                    { id: 'calendar', label: 'Calendar', icon: '🗓️', href: '/admin-calendar.html', badge: 'New' },
                    { id: 'pricing', label: 'Pricing', icon: '💰', href: '/admin-pricing.html' }
                ]
            },
            {
                title: 'Marketing',
                items: [
                    { id: 'marketing', label: 'Automation', icon: '📧', href: '/admin-marketing.html' },
                    { id: 'promotions', label: 'Promotions', icon: '🎁', href: '/admin-promotions.html' },
                    { id: 'reviews', label: 'Reviews', icon: '⭐', href: '/admin-reviews.html' }
                ]
            },
            {
                title: 'Content',
                items: [
                    { id: 'content', label: 'Website', icon: '📝', href: '/admin-content.html' },
                    { id: 'inbox', label: 'Inbox', icon: '📬', href: '/admin-inbox.html', badge: 'New' }
                ]
            },
            {
                title: 'System',
                items: [
                    { id: 'notifications', label: 'Notifications', icon: '🔔', href: '/admin-notifications.html', badge: 'New' },
                    { id: 'security', label: 'Security', icon: '🔒', href: '/admin-security.html' }
                ]
            }
        ]
    };

    // Detect current page from URL
    function getCurrentPageId() {
        const path = window.location.pathname;
        const pageMap = {
            '/admin-dashboard.html': 'dashboard',
            '/admin-analytics.html': 'analytics',
            '/admin-bookings.html': 'bookings',
            '/admin-calendar.html': 'calendar',
            '/admin-pricing.html': 'pricing',
            '/admin-marketing.html': 'marketing',
            '/admin-promotions.html': 'promotions',
            '/admin-reviews.html': 'reviews',
            '/admin-content.html': 'content',
            '/admin-inbox.html': 'inbox',
            '/admin-notifications.html': 'notifications',
            '/admin-security.html': 'security'
        };
        return pageMap[path] || 'dashboard';
    }

    // Get page title from current page ID
    function getPageTitle(pageId) {
        const titles = {
            'dashboard': 'Dashboard',
            'analytics': 'Analytics',
            'bookings': 'Booking Management',
            'calendar': 'Calendar View',
            'pricing': 'Pricing & Rates',
            'marketing': 'Marketing Automation',
            'promotions': 'Promotional Codes',
            'reviews': 'Reviews & Feedback',
            'content': 'Content Management',
            'inbox': 'Admin Inbox',
            'notifications': 'Notifications',
            'security': 'Security Settings'
        };
        return titles[pageId] || 'Admin';
    }

    // Create sidebar HTML
    function createSidebar(currentPageId) {
        let navHtml = '';
        
        navConfig.sections.forEach(section => {
            navHtml += `<div class="admin-nav-section">`;
            navHtml += `<div class="admin-nav-section-title">${section.title}</div>`;
            
            section.items.forEach(item => {
                const isActive = item.id === currentPageId ? 'active' : '';
                const badge = item.badge ? `<span class="admin-nav-badge">${item.badge}</span>` : '';
                navHtml += `
                    <a href="${item.href}" class="admin-nav-link ${isActive}">
                        <span class="admin-nav-icon">${item.icon}</span>
                        <span>${item.label}</span>
                        ${badge}
                    </a>
                `;
            });
            
            navHtml += `</div>`;
        });

        return `
            <aside class="admin-sidebar" id="adminSidebar">
                <div class="admin-sidebar-header">
                    <span class="admin-sidebar-logo">🏔️</span>
                    <div>
                        <div class="admin-sidebar-title">Lakeside Retreat</div>
                        <div class="admin-sidebar-subtitle">Admin Panel</div>
                    </div>
                </div>
                <nav class="admin-nav">
                    ${navHtml}
                </nav>
                <div class="admin-sidebar-footer">
                    <button class="admin-logout-btn" onclick="adminShell.logout()">
                        <span>🚪</span>
                        <span>Logout</span>
                    </button>
                </div>
            </aside>
            <div class="admin-sidebar-overlay" id="adminSidebarOverlay" onclick="adminShell.closeSidebar()"></div>
        `;
    }

    // Create topbar HTML
    function createTopbar(pageTitle) {
        return `
            <header class="admin-topbar">
                <div class="admin-topbar-left">
                    <button class="admin-menu-toggle" onclick="adminShell.toggleSidebar()">☰</button>
                    <h1 class="admin-page-title">${pageTitle}</h1>
                </div>
                <div class="admin-topbar-right">
                    <span id="adminUserInfo" style="font-size: 0.9rem; color: #666;">Admin</span>
                </div>
            </header>
        `;
    }

    // Initialize the admin shell
    function initAdminShell() {
        // Check authentication
        const token = localStorage.getItem('adminToken');
        if (!token) {
            window.location.href = '/admin.html';
            return;
        }

        const currentPageId = getCurrentPageId();
        const pageTitle = getPageTitle(currentPageId);

        // Find or create the shell container
        const body = document.body;
        const existingContent = body.innerHTML;

        // Wrap existing content in admin shell structure
        body.innerHTML = `
            <div class="admin-shell">
                ${createSidebar(currentPageId)}
                <main class="admin-main">
                    ${createTopbar(pageTitle)}
                    <div class="admin-content" id="adminPageContent">
                        ${existingContent}
                    </div>
                </main>
            </div>
        `;

        // Remove old header if it exists (we're replacing it with the shell)
        const oldHeader = document.querySelector('#adminPageContent > .header');
        if (oldHeader) {
            oldHeader.remove();
        }

        // Update document title
        document.title = `${pageTitle} - Lakeside Retreat Admin`;
    }

    // Public API
    window.adminShell = {
        toggleSidebar: function() {
            const sidebar = document.getElementById('adminSidebar');
            const overlay = document.getElementById('adminSidebarOverlay');
            sidebar.classList.toggle('open');
            overlay.classList.toggle('open');
        },

        closeSidebar: function() {
            const sidebar = document.getElementById('adminSidebar');
            const overlay = document.getElementById('adminSidebarOverlay');
            sidebar.classList.remove('open');
            overlay.classList.remove('open');
        },

        logout: function() {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin.html';
        },

        // Method to update notification badge
        setNotificationBadge: function(count) {
            const notificationLinks = document.querySelectorAll('.admin-nav-link[href*="notifications"]');
            notificationLinks.forEach(link => {
                let badge = link.querySelector('.admin-nav-badge');
                if (count > 0) {
                    if (!badge) {
                        badge = document.createElement('span');
                        badge.className = 'admin-nav-badge';
                        link.appendChild(badge);
                    }
                    badge.textContent = count > 99 ? '99+' : count;
                } else if (badge && badge.textContent !== 'New') {
                    badge.remove();
                }
            });
        },

        // Method to show alert
        showAlert: function(message, type = 'info') {
            const alertContainer = document.getElementById('adminAlertContainer') || 
                                   document.querySelector('.admin-content');
            if (!alertContainer) return;

            const alert = document.createElement('div');
            alert.className = `admin-alert admin-alert-${type}`;
            alert.innerHTML = `
                <span>${message}</span>
                <button onclick="this.parentElement.remove()" style="float: right; background: none; border: none; cursor: pointer; font-size: 1.2rem;">&times;</button>
            `;
            
            alertContainer.insertBefore(alert, alertContainer.firstChild);
            
            // Auto-remove after 5 seconds
            setTimeout(() => {
                if (alert.parentElement) {
                    alert.remove();
                }
            }, 5000);
        },

        // Re-initialize (useful after dynamic content changes)
        refresh: function() {
            const currentPageId = getCurrentPageId();
            const navLinks = document.querySelectorAll('.admin-nav-link');
            navLinks.forEach(link => {
                const href = link.getAttribute('href');
                const pageMap = {
                    '/admin-dashboard.html': 'dashboard',
                    '/admin-analytics.html': 'analytics',
                    '/admin-bookings.html': 'bookings',
                    '/admin-calendar.html': 'calendar',
                    '/admin-pricing.html': 'pricing',
                    '/admin-marketing.html': 'marketing',
                    '/admin-promotions.html': 'promotions',
                    '/admin-reviews.html': 'reviews',
                    '/admin-content.html': 'content',
                    '/admin-inbox.html': 'inbox',
                    '/admin-notifications.html': 'notifications',
                    '/admin-security.html': 'security'
                };
                const linkPageId = pageMap[href];
                if (linkPageId === currentPageId) {
                    link.classList.add('active');
                } else {
                    link.classList.remove('active');
                }
            });
        }
    };

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAdminShell);
    } else {
        initAdminShell();
    }
})();
