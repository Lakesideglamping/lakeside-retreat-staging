/**
 * Admin Shell - Unified Navigation System
 * This script injects a consistent sidebar navigation into all admin pages.
 *
 * SOURCE OF TRUTH: The root-level admin-shell.js and admin-shell.css files
 * are the canonical source. After making changes here, copy them to the
 * public/ directory to keep both locations in sync:
 *   cp admin-shell.js public/admin-shell.js
 *   cp admin-shell.css public/admin-shell.css
 * The root files drive development; public/ is the served copy.
 */

(function() {
    'use strict';

    // Session timeout - 30 minutes of inactivity
    let lastActivityTime = Date.now();
    const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

    function updateActivity() {
        lastActivityTime = Date.now();
    }

    function checkSessionTimeout() {
        if (Date.now() - lastActivityTime > SESSION_TIMEOUT) {
            // Call logout endpoint to clear the httpOnly cookie, then redirect
            fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' })
                .finally(() => {
                    window.location.href = '/admin.html';
                });
        }
    }

    document.addEventListener('click', updateActivity);
    document.addEventListener('keypress', updateActivity);
    document.addEventListener('scroll', updateActivity);
    setInterval(checkSessionTimeout, 60000); // Check every minute

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
            navHtml += `<div class="admin-nav-section" role="group" aria-label="${section.title}">`;
            navHtml += `<div class="admin-nav-section-title" id="nav-section-${section.title.toLowerCase()}">${section.title}</div>`;

            section.items.forEach(item => {
                const isActive = item.id === currentPageId ? 'active' : '';
                const ariaCurrent = item.id === currentPageId ? 'aria-current="page"' : '';
                const badge = item.badge ? `<span class="admin-nav-badge" aria-label="${item.badge} indicator">${item.badge}</span>` : '';
                navHtml += `
                    <a href="${item.href}" class="admin-nav-link ${isActive}" ${ariaCurrent} aria-label="${item.label}">
                        <span class="admin-nav-icon" aria-hidden="true">${item.icon}</span>
                        <span>${item.label}</span>
                        ${badge}
                    </a>
                `;
            });

            navHtml += `</div>`;
        });

        return `
            <aside class="admin-sidebar" id="adminSidebar" aria-label="Admin sidebar">
                <div class="admin-sidebar-header">
                    <span class="admin-sidebar-logo" aria-hidden="true">🏔️</span>
                    <div>
                        <div class="admin-sidebar-title">Lakeside Retreat</div>
                        <div class="admin-sidebar-subtitle">Admin Panel</div>
                    </div>
                </div>
                <nav class="admin-nav" role="navigation" aria-label="Admin navigation">
                    ${navHtml}
                </nav>
                <div class="admin-sidebar-footer">
                    <button class="admin-logout-btn" onclick="adminShell.logout()" aria-label="Logout">
                        <span aria-hidden="true">🚪</span>
                        <span>Logout</span>
                    </button>
                </div>
            </aside>
            <div class="admin-sidebar-overlay" id="adminSidebarOverlay" onclick="adminShell.closeSidebar()" aria-hidden="true"></div>
        `;
    }

    // Create topbar HTML
    function createTopbar(pageTitle) {
        return `
            <header class="admin-topbar" role="banner">
                <div class="admin-topbar-left">
                    <button class="admin-menu-toggle" onclick="adminShell.toggleSidebar()" aria-label="Toggle navigation menu" aria-expanded="false" aria-controls="adminSidebar">
                        <span aria-hidden="true">☰</span>
                    </button>
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
        // Verify session via httpOnly cookie by calling the verify endpoint
        fetch('/api/admin/verify', { credentials: 'same-origin' })
            .then(response => {
                if (!response.ok) {
                    window.location.href = '/admin.html';
                    return;
                }
                // Session is valid, proceed to build the shell
                buildAdminShell();
            })
            .catch(() => {
                window.location.href = '/admin.html';
            });
    }

    function buildAdminShell() {
        const currentPageId = getCurrentPageId();
        const pageTitle = getPageTitle(currentPageId);

        // Find or create the shell container
        const body = document.body;
        const existingContent = body.innerHTML;

        // Wrap existing content in admin shell structure with skip-to-content link
        body.innerHTML = `
            <a href="#adminPageContent" class="skip-to-content">Skip to main content</a>
            <div class="admin-shell">
                ${createSidebar(currentPageId)}
                <main class="admin-main" role="main">
                    ${createTopbar(pageTitle)}
                    <div class="admin-content" id="adminPageContent" tabindex="-1">
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

        // Set up keyboard event listeners for accessibility
        setupKeyboardHandlers();
    }

    // Set up keyboard event handlers for accessibility
    function setupKeyboardHandlers() {
        document.addEventListener('keydown', function(e) {
            // Escape key closes sidebar on mobile
            if (e.key === 'Escape') {
                const sidebar = document.getElementById('adminSidebar');
                if (sidebar && sidebar.classList.contains('open')) {
                    adminShell.closeSidebar();
                    // Return focus to the menu toggle button
                    const toggleBtn = document.querySelector('.admin-menu-toggle');
                    if (toggleBtn) {
                        toggleBtn.focus();
                    }
                }
            }
        });
    }

    /**
     * Trap focus within an element (useful for modals).
     * Call this when opening a modal, and store the returned cleanup
     * function to release the trap when the modal closes.
     *
     * Usage:
     *   const releaseTrap = adminShell.trapFocus(modalElement);
     *   // ... when closing:
     *   releaseTrap();
     *
     * @param {HTMLElement} element - The container to trap focus within
     * @returns {Function} A cleanup function that removes the focus trap
     */
    function trapFocus(element) {
        const focusableSelectors = [
            'a[href]',
            'button:not([disabled])',
            'textarea:not([disabled])',
            'input:not([disabled]):not([type="hidden"])',
            'select:not([disabled])',
            '[tabindex]:not([tabindex="-1"])'
        ].join(', ');

        const focusableElements = element.querySelectorAll(focusableSelectors);
        const firstFocusable = focusableElements[0];

        // Focus the first focusable element inside the trap
        if (firstFocusable) {
            firstFocusable.focus();
        }

        function handleTabKey(e) {
            if (e.key !== 'Tab') return;

            // Re-query in case DOM changed
            const currentFocusable = element.querySelectorAll(focusableSelectors);
            const first = currentFocusable[0];
            const last = currentFocusable[currentFocusable.length - 1];

            if (!first) return;

            if (e.shiftKey) {
                // Shift+Tab: if focus is on first element, wrap to last
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                // Tab: if focus is on last element, wrap to first
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }

        document.addEventListener('keydown', handleTabKey);

        // Return cleanup function
        return function releaseTrap() {
            document.removeEventListener('keydown', handleTabKey);
        };
    }

    // Global XSS protection utility
    window.escapeHtml = function(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };

    // Public API
    window.adminShell = {
        toggleSidebar: function() {
            const sidebar = document.getElementById('adminSidebar');
            const overlay = document.getElementById('adminSidebarOverlay');
            const toggleBtn = document.querySelector('.admin-menu-toggle');
            sidebar.classList.toggle('open');
            overlay.classList.toggle('open');
            // Update aria-expanded on the toggle button
            const isOpen = sidebar.classList.contains('open');
            if (toggleBtn) {
                toggleBtn.setAttribute('aria-expanded', String(isOpen));
            }
        },

        closeSidebar: function() {
            const sidebar = document.getElementById('adminSidebar');
            const overlay = document.getElementById('adminSidebarOverlay');
            const toggleBtn = document.querySelector('.admin-menu-toggle');
            sidebar.classList.remove('open');
            overlay.classList.remove('open');
            if (toggleBtn) {
                toggleBtn.setAttribute('aria-expanded', 'false');
            }
        },

        logout: function() {
            fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' })
                .finally(() => {
                    window.location.href = '/admin.html';
                });
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
            const span = document.createElement('span');
            span.textContent = message;
            const closeBtn = document.createElement('button');
            closeBtn.textContent = '\u00D7';
            closeBtn.style.cssText = 'float: right; background: none; border: none; cursor: pointer; font-size: 1.2rem;';
            closeBtn.addEventListener('click', function() { alert.remove(); });
            alert.appendChild(span);
            alert.appendChild(closeBtn);
            
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
        },

        /**
         * Trap focus within a given element (for modal accessibility).
         * Returns a cleanup function to release the trap.
         *
         * Usage:
         *   const release = adminShell.trapFocus(document.getElementById('myModal'));
         *   // later, when closing the modal:
         *   release();
         */
        trapFocus: trapFocus
    };

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAdminShell);
    } else {
        initAdminShell();
    }
})();
