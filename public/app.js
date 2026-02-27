/* Extracted from inline <script> blocks in index.html */

// --- Script block 1 ---
(function() {
window.dataLayer = window.dataLayer || [];
      window.gtag = function(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-M6TC9MB5CR', {
        'enhanced_ecommerce': true,
        'send_page_view': true,
        'custom_map': {
          'custom_parameter_1': 'accommodation_type',
          'custom_parameter_2': 'booking_source'
        }
      });
      
      // Enhanced tracking for accommodation bookings
      window.trackBookingIntent = function(accommodationType) {
        gtag('event', 'booking_intent', {
          'accommodation_type': accommodationType,
          'page_location': window.location.href
        });
      }
      
      // Wine tour interest tracking
      function trackWineTourInterest() {
        gtag('event', 'wine_tour_interest', {
          'content_category': 'central_otago_activities'
        });
      }
})();

// --- Script block 2 ---
(function() {
// Register service worker for caching and offline support
if ('serviceWorker' in navigator && 'caches' in window) {
    window.addEventListener('load', () => {
        // Simple service worker for caching static assets
        const swCode = `
            const CACHE_NAME = 'lakeside-retreat-v1';
            const urlsToCache = [
                '/',
                '/index.html',
                'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap',
                'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
            ];
            
            self.addEventListener('install', (event) => {
                event.waitUntil(
                    caches.open(CACHE_NAME)
                        .then((cache) => cache.addAll(urlsToCache))
                );
            });
            
            self.addEventListener('fetch', (event) => {
                event.respondWith(
                    caches.match(event.request)
                        .then((response) => {
                            return response || fetch(event.request);
                        }
                    )
                );
            });
        `;
        
        // Create and register service worker
        const blob = new Blob([swCode], { type: 'application/javascript' });
        const swUrl = URL.createObjectURL(blob);
        
        navigator.serviceWorker.register(swUrl)
            .then(() => {}) // Console statement removed for production
            .catch(() => {}); // Console statement removed for production
    });
}

// Enhanced WebP detection and image optimization
window.detectWebPSupport = function() {
    const webP = new Image();
    webP.onload = webP.onerror = () => {
        document.documentElement.classList.add(webP.height === 2 ? 'webp' : 'no-webp');
    };
    webP.src = 'data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAACyAgCdASoCAAIALmk0mk0iIiIiIgBoSygABc6WWgAA/veff/0PP8bA//LwYAAA';
}
})();

// --- Script block 3 ---
(function() {
// Initialize optimizations
document.addEventListener('DOMContentLoaded', () => {
    detectWebPSupport();
    
    // Optimize images with lazy loading
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        img.classList.remove('lazy');
                        imageObserver.unobserve(img);
                    }
                }
            });
        });
        
        // Observe images with data-src attribute
        document.querySelectorAll('img[data-src]').forEach(img => {
            imageObserver.observe(img);
        });
    }
});
})();

// --- Script block 4 ---
(function() {
{
      "@context": "https://schema.org",
      "@type": "LodgingBusiness",
      "@id": "https://lakesideretreat.co.nz/#organization",
      "name": "Lakeside Retreat Central Otago",
      "alternateName": "Lakeside Glamping",
      "description": "Central Otago's premier luxury glamping accommodation on Lake Dunstan with solar power system, Powerwall, direct Otago Rail Trail access, and proximity to 30+ wineries",
      "url": "https://lakesideretreat.co.nz/",
      "logo": "https://lakesideretreat.co.nz/images/logo.png",
      "image": [
        "https://lakesideretreat.co.nz/images/dome-pinot-exterior.jpg",
        "https://lakesideretreat.co.nz/images/dome-rose-spa1.jpg",
        "https://lakesideretreat.co.nz/images/lakeside-cottage-lake-view.jpg"
      ],
      "telephone": "+64-21-368-682",
      "email": "info@lakesideretreat.co.nz",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "96 Smiths Way, Mount Pisa",
        "addressLocality": "Cromwell",
        "addressRegion": "Otago",
        "postalCode": "9310",
        "addressCountry": "NZ"
      },
      "geo": {
        "@type": "GeoCoordinates",
        "latitude": -45.038710,
        "longitude": 169.197693
      },
      "openingHoursSpecification": {
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": [
          "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
        ],
        "opens": "08:00",
        "closes": "20:00"
      },
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": "4.9",
        "reviewCount": "127",
        "bestRating": "5",
        "worstRating": "1"
      },
      "amenityFeature": [
        {
          "@type": "LocationFeatureSpecification",
          "name": "Commercial-Grade Solar System",
          "value": "16.72kW Solar Array with 38 x 440W Helios Panels"
        },
        {
          "@type": "LocationFeatureSpecification", 
          "name": "Energy Storage System",
          "value": "Signergy Battery Storage)"
        },
        {
          "@type": "LocationFeatureSpecification",
          "name": "Smart Energy Management",
          "value": "20kW Hybrid Inverter with Real-time Monitoring"
        },
        {
          "@type": "LocationFeatureSpecification",
          "name": "Energy Independence",
          "value": "Energy-Positive Operations Contributing to NZ Grid"
        },
        {
          "@type": "LocationFeatureSpecification",
          "name": "Private Hot Tub",
          "value": true
        },
        {
          "@type": "LocationFeatureSpecification",
          "name": "Lake Access",
          "value": "Direct Lake Dunstan access"
        },
        {
          "@type": "LocationFeatureSpecification",
          "name": "Cycle Trail Access",
          "value": "Otago Rail Trail - 300 metre walk"
        },
        {
          "@type": "LocationFeatureSpecification",
          "name": "Wine Country Location",
          "value": "15+ wineries within 15km"
        }
      ],
      "starRating": {
        "@type": "Rating",
        "ratingValue": "5"
      },
      "priceRange": "$$$",
      "currenciesAccepted": "NZD",
      "paymentAccepted": "Cash, Credit Card, Debit Card",
      "checkinTime": "15:00",
      "checkoutTime": "10:00",
      "petsAllowed": "Lakeside Cottage only",
      "smokingAllowed": false,
      "numberOfRooms": "3",
      "maximumAttendeeCapacity": "6",
      "hasMap": "https://maps.google.com/?q=-45.038710,169.197693",
      "sameAs": [
        "https://www.facebook.com/lakesideretreat",
        "https://www.instagram.com/lakesideretreat",
        "https://www.airbnb.com/h/lakesideretreat",
        "https://www.booking.com/hotel/nz/lakeside-retreat.html"
      ]
    }
})();

// --- Script block 5 ---
(function() {
{
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": "Lakeside Retreat Central Otago",
      "alternateName": "Lakeside Retreat",
      "url": "https://lakesideretreat.co.nz",
      "logo": "https://lakesideretreat.co.nz/images/logo.png",
      "foundingDate": "2019",
      "founder": {
        "@type": "Person",
        "name": "Stephen & Sandy"
      },
      "description": "Sustainable luxury accommodation specialists in Central Otago, pioneering grid-tied solar tourism experiences",
      "knowsAbout": [
        "Solar Energy Systems",
        "Sustainable Tourism", 
        "Central Otago Wine Region",
        "Otago Rail Trail",
        "Lake Dunstan Activities",
        "Eco Glamping"
      ],
      "contactPoint": {
        "@type": "ContactPoint",
        "telephone": "+64-21-368-682",
        "contactType": "customer service",
        "availableLanguage": ["English"],
        "areaServed": "NZ"
      },
      "sameAs": [
        "https://www.facebook.com/lakesideretreat",
        "https://www.instagram.com/lakesideretreat",
        "https://www.tripadvisor.com/lakesideretreat",
        "https://www.booking.com/lakesideretreat"
      ]
    }
})();

// --- Script block 6 ---
(function() {
{
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": [{
        "@type": "Question",
        "name": "Where is Lakeside Retreat located in Central Otago?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Lakeside Retreat is located at 96 Smiths Way, Mount Pisa, just 12km from Cromwell town centre. We're positioned directly on Lake Dunstan in the heart of Central Otago wine country, with the cycle trail just 300m from our accommodation."
        }
      },{
        "@type": "Question",
        "name": "What type of accommodation do you offer in Central Otago?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "We offer luxury glamping domes and a family cottage, all with Lake Dunstan and mountains view. Dome Pinot (50sqm) and Dome Rosé (40sqm) are perfect for couples, while our Lakeside Cottage accommodates families with direct lake access. All accommodation is powered by grid-tied solar with battery backup."
        }
      },{
        "@type": "Question",
        "name": "How close are you to Central Otago wineries?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "We're located in the heart of Central Otago wine country with 15+ wineries within 15km. Our own vineyard setting puts you amongst award-winning Pinot Noir producers, with many cellar doors accessible by bike via the cycle trail."
        }
      },{
        "@type": "Question",
        "name": "How does your 16.72kW solar power system work?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Our 16.72kW grid-tied solar system with 16kWh Signergy battery provides clean energy while maintaining 100% reliability for guests. Being grid-tied means you'll never experience power outages, while we contribute excess renewable energy back to New Zealand's grid."
        }
      },{
        "@type": "Question",
        "name": "Can I access the Otago Rail Trail from your accommodation?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Yes! The famous Otago Rail Trail is just a 300-metre walk from our domes. You can easily access the Cromwell to Clyde section, rent bikes in Cromwell, and arrange luggage transfers. It's perfect for wine country cycling and exploring Central Otago's heritage."
        }
      },{
        "@type": "Question",
        "name": "What activities are available on Lake Dunstan?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Lake Dunstan offers kayaking, paddleboarding, fishing, and scenic walks right from our doorstep. The lake is perfect for photography, bird watching, and water sports. The Cromwell Gorge walks provide stunning views and heritage sites."
        }
      }]
    }
})();

// --- Script block 7 ---
(function() {
{
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [{
        "@type": "ListItem",
        "position": 1,
        "name": "Central Otago Accommodation",
        "item": "https://lakesideretreat.co.nz/"
      },{
        "@type": "ListItem", 
        "position": 2,
        "name": "Lake Dunstan Accommodation",
        "item": "https://lakesideretreat.co.nz/#accommodations"
      },{
        "@type": "ListItem",
        "position": 3,
        "name": "Cromwell Wine Country Activities", 
        "item": "https://lakesideretreat.co.nz/#explore"
      }]
    }
})();

// --- Script block 8 ---
(function() {
{
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": "Lakeside Retreat Central Otago",
      "url": "https://lakesideretreat.co.nz",
      "potentialAction": {
        "@type": "SearchAction",
        "target": "https://lakesideretreat.co.nz/search?q={search_term_string}",
        "query-input": "required name=search_term_string"
      },
      "sameAs": [
        "https://www.facebook.com/lakesideretreat",
        "https://www.instagram.com/lakesideretreat"
      ]
    }
})();

// --- Script block 9 ---
(function() {
{
      "@context": "https://schema.org",
      "@type": "Blog",
      "name": "Central Otago Wine Country & Solar Energy Blog",
      "description": "Expert guides for Central Otago wine country, sustainable travel, and renewable energy tourism",
      "url": "https://lakesideretreat.co.nz/blog",
      "author": {
        "@type": "Organization",
        "name": "Lakeside Retreat Central Otago"
      },
      "publisher": {
        "@type": "Organization",
        "name": "Lakeside Retreat Central Otago",
        "logo": {
          "@type": "ImageObject",
          "url": "https://lakesideretreat.co.nz/images/logo.png"
        }
      },
      "inLanguage": "en-NZ"
    }
})();

// --- Script block 10 ---
(function() {
// WebP support detection
      function supportsWebP() {
        return new Promise(resolve => {
          const webP = new Image();
          webP.onload = webP.onerror = () => resolve(webP.height === 2);
          webP.src = 'data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAACyAgCdASoCAAIALmk0mk0iIiIiIgBoSygABc6WWgAA/veff/0PP8bA//LwYAAA';
        });
      }
      
      supportsWebP().then(supported => {
        document.documentElement.classList.add(supported ? 'webp' : 'no-webp');
        
        // Progressive image loading for mobile
        if (supported) {
          implementProgressiveImageLoading();
        }
        
        // Initialize lazy loading for images
        if ('IntersectionObserver' in window) {
          const imageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
              if (entry.isIntersecting) {
                const img = entry.target;
                if (img.dataset.src) {
                  img.src = img.dataset.src;
                  img.classList.remove('lazy');
                  imageObserver.unobserve(img);
                }
              }
            });
          }, {
            rootMargin: '50px 0px',
            threshold: 0.01
          });
          
          // Apply lazy loading to images below the fold
          document.querySelectorAll('img[data-src]').forEach(img => {
            imageObserver.observe(img);
          });
        }
      });
      
      function implementProgressiveImageLoading() {
        // Convert JPEG images to WebP format dynamically for supported browsers
        document.querySelectorAll('img[src*=".jpeg"], img[src*=".jpg"]').forEach(img => {
          const webpSrc = img.src.replace(/\.(jpe?g)$/i, '.webp');
          
          // Test if WebP version exists
          const testImg = new Image();
          testImg.onload = () => {
            img.src = webpSrc;
          };
          testImg.onerror = () => {
            // Keep original if WebP doesn't exist
          };
          testImg.src = webpSrc;
        });
      }
      
      // Service Worker for caching
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
      }
      
      // Initialize security on page load
      document.addEventListener('DOMContentLoaded', function() {
        // Initialize secure frontend functions
        if (window.SecureFrontend) {
          window.SecureFrontend.logSecurityEvent('page_loaded', {
            url: window.location.href,
            timestamp: new Date().toISOString()
          });
        }
      });
})();

// --- Script block 11 ---
(function() {
class WebsiteSecurityManager {
    constructor() {
        this.csrfToken = '';
        this.apiCallLimits = new Map();
        this.init();
    }
    
    async init() {
        try {
            this.setupFormValidation();
            this.setupRateLimiting();
            this.monitorPerformance();
            // Console statement removed for production
        } catch (error) {
            // Console statement removed for production
        }
    }
    
    // Enhanced email validation
    validateEmail(email) {
        const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
        return emailRegex.test(email) && email.length <= 254;
    }
    
    // Input sanitization
    sanitizeInput(input) {
        if (typeof input !== 'string') return input;
        return input
            .replace(/[<>]/g, '')
            .replace(/javascript:/gi, '')
            .replace(/on\w+=/gi, '')
            .trim();
    }
    
    // Rate limiting for API calls
    checkRateLimit(endpoint, maxCalls = 10) {
        const now = Date.now();
        const calls = this.apiCallLimits.get(endpoint) || [];
        const recentCalls = calls.filter(time => now - time < 60000);
        
        if (recentCalls.length >= maxCalls) {
            throw new Error('Rate limit exceeded. Please try again later.');
        }
        
        recentCalls.push(now);
        this.apiCallLimits.set(endpoint, recentCalls);
        return true;
    }
    
    // Form validation setup
    setupFormValidation() {
        document.addEventListener('submit', (event) => {
            const form = event.target;
            if (form.tagName === 'FORM') {
                const inputs = form.querySelectorAll('input[type="email"]');
                let isValid = true;
                
                inputs.forEach(input => {
                    if (input.value && !this.validateEmail(input.value)) {
                        isValid = false;
                        this.showFieldError(input, 'Please enter a valid email address');
                    }
                });
                
                if (!isValid) {
                    event.preventDefault();
                }
            }
        });
    }
    
    // Enhanced error display
    showFieldError(field, message) {
        const existingError = field.parentNode.querySelector('.field-error');
        if (existingError) existingError.remove();
        
        const errorDiv = document.createElement('div');
        errorDiv.className = 'field-error';
        errorDiv.style.cssText = 'color: #dc2626; font-size: 0.875rem; margin-top: 0.25rem;';
        errorDiv.textContent = message;
        
        field.parentNode.appendChild(errorDiv);
        field.style.borderColor = '#dc2626';
        
        // Clear error on input
        field.addEventListener('input', () => {
            errorDiv.remove();
            field.style.borderColor = '';
        }, { once: true });
    }
    
    // Performance monitoring
    monitorPerformance() {
        if ('PerformanceObserver' in window) {
            new PerformanceObserver((entryList) => {
                const entries = entryList.getEntries();
                const lastEntry = entries[entries.length - 1];
                if (typeof gtag !== 'undefined') {
                    gtag('event', 'web_vitals', {
                        'metric_name': 'LCP',
                        'metric_value': Math.round(lastEntry.startTime)
                    });
                }
            }).observe({entryTypes: ['largest-contentful-paint']});
        }
    }
    
    setupRateLimiting() {
        window.limitedBookingAttempt = (callback) => {
            try {
                this.checkRateLimit('booking', 5);
                callback();
            } catch (error) {
                alert('Too many booking attempts. Please wait a moment before trying again.');
            }
        };
    }
}

// Enhanced Error Handling
window.addEventListener('error', (event) => {
    // Script error caught - handled silently in production
});

window.addEventListener('unhandledrejection', (event) => {
    // Promise rejection caught - handled silently in production
});

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    window.securityManager = new WebsiteSecurityManager();
});
})();

// --- Script block 12 ---
(function() {
// Security functions
        function sanitizeHTML(str) {
            const temp = document.createElement('div');
            temp.textContent = str;
            return temp.innerHTML;
        }
        
        function safeSetContent(elementId, content, isHTML = false) {
            const element = document.getElementById(elementId);
            if (!element) return;
            
            if (isHTML) {
                // Only allow specific safe HTML patterns
                const safeHTML = content
                    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                    .replace(/javascript:/gi, '')
                    .replace(/on\w+="[^"]*"/gi, '')
                    .replace(/on\w+='[^']*'/gi, '');
                element.innerHTML = safeHTML;
            } else {
                element.textContent = content;
            }
        }
        
        function safeCreateSelectOptions(selectElement, options) {
            selectElement.innerHTML = ''; // Clear existing options
            options.forEach(option => {
                const optionElement = document.createElement('option');
                optionElement.value = option.value;
                optionElement.textContent = option.text;
                if (option.selected) optionElement.selected = true;
                selectElement.appendChild(optionElement);
            });
        }

        // Global variables
        let currentPage = 'home';
        let currentImageIndex = 0;
        let socialProofIndex = 0;
        let reviewsLoaded = 6;
        let touchStartX = 0;
        let touchEndX = 0;

        // Booking system variables
        let selectedAccommodation = null;
        let currentBookingStep = 1;
        let bookingData = {};

        // Mock Uplisting API rates (NZD)
        const accommodationRates = {
            'dome-pinot': { base: 450, peak: 530, offPeak: 350 },
            'dome-rose': { base: 380, peak: 450, offPeak: 300 },
            'lakeside-cottage': { base: 580, peak: 680, offPeak: 480 }
        };

        const accommodationNames = {
            'dome-pinot': 'Dome Pinot',
            'dome-rose': 'Dome Rosé',
            'lakeside-cottage': 'Lakeside Cottage'
        };

        // Page navigation data
        const pages = ['home', 'stay', 'gallery', 'blog', 'reviews', 'story', 'explore', 'contact'];

        // Gallery images from stay page click
        const galleryImages = [
            'images/galerryrose.jpeg',
            'images/gallerydecksideview.jpeg',
            'images/gallerydecksitting.jpeg',
            'images/gallerypinotbed.jpeg',
            'images/dome-pinot-hero.jpeg',
            'images/dome-pinot-interior.jpeg',
            'images/dome-rose-interior.jpeg',
            'images/gallerydeck.jpeg',
            'images/gallerypinotbed.jpeg',
	    'images/GallerySwingChair.jpeg',
        ];

        // Carousel-specific image arrays
        const carouselImages = {
            'pinot': [
                'images/Desktop/pinot-internal.jpeg',
                'images/Desktop/Pinotfront.jpeg',
                'images/Desktop/windowview.jpeg',
                'images/Desktop/pinotspa.jpeg',
                'images/Desktop/GallerySwingChair.jpeg'
            ],
            'rose': [
                'images/Desktop/IMG_E8919-1000x700.jpeg',
                'images/Desktop/IMG_1403-1000x700.jpeg',
                'images/Desktop/rosespa.jpeg',
                'images/Desktop/gallerydecksitting.jpeg',
                'images/Desktop/dome-rose-interior.jpeg'
            ],
            'cottage': [
                'images/Desktop/lakeside-cottage-exterior.jpeg',
                'images/Desktop/cottage.jpg',
                'images/Desktop/Hottub1000x700.jpeg',
                'images/Desktop/cottagebathroom.jpeg',
                'images/Desktop/cottagebedroom.jpeg'
            ]
        };

        // Keep track of current carousel context
        let currentCarouselContext = null;

        // Search data
        const searchData = [
            { title: 'Central Otago Accommodation', page: 'stay', description: 'Luxury glamping domes and cottage with Lake Dunstan views' },
            { title: 'Cromwell Accommodation', page: 'stay', description: 'Premium accommodation 12km from Cromwell town centre' },
            { title: 'Lake Dunstan Accommodation', page: 'stay', description: 'Waterfront luxury with direct lake access and panoramic views' },
            { title: 'Dome Pinot', page: 'stay', description: '50sqm luxury dome with Lake Dunstan views and private spa' },
            { title: 'Dome Rosé', page: 'stay', description: 'Romantic retreat perfect for couples in wine country' },
            { title: 'Lakeside Cottage', page: 'stay', description: 'Family-friendly accommodation with direct lake access' },
            { title: 'Central Otago Wine Country', page: 'explore', description: 'World-class Pinot Noir wineries within 15km' },
            { title: 'Cycle Trail Accommodation', page: 'explore', description: 'Lake Dunstan Trail access 300m from accommodation' },
            { title: 'Sustainable Accommodation', page: 'home', description: 'Grid-tied solar powered luxury with battery backup' },
            { title: 'Cromwell to Clyde Cycle Trail', page: 'explore', description: 'Direct access to scenic cycling routes' }
        ];

        // Social proof messages
        const socialProofMessages = [
            { name: 'Sarah from Auckland', action: 'just booked Dome Pinot', time: '2 minutes ago' },
            { name: 'Mike from Melbourne', action: 'just booked Lakeside Cottage', time: '5 minutes ago' },
            { name: 'Lisa from Wellington', action: 'just booked Dome Rosé', time: '8 minutes ago' },
            { name: 'David from Sydney', action: 'just booked an energy system tour', time: '12 minutes ago' },
            { name: 'Emma from Christchurch', action: 'just booked Lakeside Cottage', time: '15 minutes ago' }
        ];

        // CSRF Token Management
        let csrfToken = '';

        async window.getCSRFToken = function() {
          try {
            const response = await fetch('/api/csrf-token', {
              credentials: 'include'
            });
            const data = await response.json();
            csrfToken = data.csrfToken;
            return csrfToken;
          } catch (error) {
            // Console statement removed for production
            return null;
          }
        }

        // Initialize website
        document.addEventListener('DOMContentLoaded', async function() {
          // Get CSRF token on page load
          await getCSRFToken();
          
          initializeWebsite();
        });

        function initializeWebsite() {
            // Set minimum dates for booking (only if elements exist)
            const today = new Date().toISOString().split('T')[0];
            const checkinInput = document.getElementById('bookingCheckin');
            const checkoutInput = document.getElementById('bookingCheckout');
            
            if (checkinInput) {
                checkinInput.min = today;
                checkinInput.addEventListener('click', function() {
                    this.showPicker();
                });
            }
            
            if (checkoutInput) {
                checkoutInput.min = today;
                checkoutInput.addEventListener('click', function() {
                    this.showPicker();
                });
            }

            // Initialize mobile optimizations
            detectTouch();
            setMobileViewportHeight();
            enhanceMobileMenu();

            // Show cookie buttons only
            setTimeout(() => {
                const cookieButtons = document.getElementById('cookieButtons');
                if (cookieButtons) {
                    cookieButtons.style.display = 'flex';
                }
            }, 2000);

            // Initialize social proof
            setTimeout(showSocialProof, 5000);

            // Initialize scroll animations
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('visible');
                    }
                });
            }, { threshold: 0.1 });

            document.querySelectorAll('.card').forEach(card => {
                observer.observe(card);
            });

            // Initialize scroll indicator
            window.addEventListener('scroll', updateScrollIndicator);

            // Initialize touch gestures for page navigation (only if element exists)
            const mainContent = document.getElementById('mainContent');
            if (mainContent) {
                mainContent.addEventListener('touchstart', handleTouchStart, { passive: true });
                mainContent.addEventListener('touchend', handleTouchEnd, { passive: true });
            }

            // Auto-close mobile menu on scroll
            window.addEventListener('scroll', () => {
                const mobileNav = document.getElementById('mobileNav');
                if (mobileNav && mobileNav.classList.contains('active')) {
                    toggleMobileMenu();
                }
            });

            // Booking form event listeners (only if elements exist)
            if (checkinInput) {
                checkinInput.addEventListener('change', updateCheckoutMinDate);
            }
            
            if (checkoutInput) {
                checkoutInput.addEventListener('change', validateCottageMinimumStay);
            }
            
            // Mobile-specific performance optimizations
            if (window.innerWidth <= 768) {
                // Reduce animation frequency on mobile
                const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
                if (reducedMotionQuery.matches) {
                    document.body.classList.add('reduce-motion');
                }
                
                // Optimize touch scrolling
                document.body.style.touchAction = 'pan-y';
                document.body.style.webkitOverflowScrolling = 'touch';
            }
        }

        // Mobile optimization functions
        let isTouch = false;
        let touchStartY = 0;
        let touchEndY = 0;
        let touchDevice = false;

        function detectTouch() {
            touchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
            if (touchDevice) {
                document.body.classList.add('touch-device');
            }
        }

        function setMobileViewportHeight() {
            const vh = window.innerHeight * 0.01;
            document.documentElement.style.setProperty('--vh', `${vh}px`);
            
            window.addEventListener('resize', () => {
                const vh = window.innerHeight * 0.01;
                document.documentElement.style.setProperty('--vh', `${vh}px`);
            });
        }

        function enhanceMobileMenu() {
            const mobileNav = document.getElementById('mobileNav');
            const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
            
            if (mobileMenuBtn) {
                mobileMenuBtn.addEventListener('touchstart', function() {
                    this.style.opacity = '0.7';
                }, { passive: true });
                
                mobileMenuBtn.addEventListener('touchend', function() {
                    this.style.opacity = '1';
                }, { passive: true });
            }
            
            if (mobileNav) {
                mobileNav.addEventListener('touchmove', function(e) {
                    if (this.classList.contains('active')) {
                        e.preventDefault();
                    }
                }, { passive: false });
            }
        }

        // === VOUCHER SYSTEM ===
        


        // === VOUCHER PURCHASE SYSTEM ===
        
        // OLD SYSTEM VARIABLES - NOW REDIRECT TO V2NEW
        let selectedVoucherAmount = 'flexible-550-v2'; // Redirect to V2New
        let currentVoucherStep = 1;
        let voucherData = {}; // Will be populated from V2New data










        // === STREAMLINED 3-BUTTON BOOKING SYSTEM ===

        window.openBookingModal = function(preSelectedAccommodation = null) {
            // Console statement removed for production
            document.getElementById('bookingModal').classList.add('active');
            document.body.style.overflow = 'hidden';
            
            // Pre-select accommodation if specified BEFORE reset
            if (preSelectedAccommodation) {
                selectedAccommodation = preSelectedAccommodation;
            }
            
            resetBookingModal();
            
            // Apply selection after reset
            if (preSelectedAccommodation) {
                selectAccommodation(preSelectedAccommodation);
                // Console statement removed for production
            }
        }

        window.closeBookingModal = function() {
            document.getElementById('bookingModal').classList.remove('active');
            document.body.style.overflow = '';
            resetBookingModal();
        }

        function resetBookingModal() {
            currentBookingStep = 1;
            bookingData = {};
            
            // Reset all steps
            document.querySelectorAll('.booking-step').forEach(step => {
                step.classList.remove('active');
            });
            document.getElementById('bookingStep1').classList.add('active');
            
            // Reset accommodation selection (but keep pre-selected if any)
            document.querySelectorAll('.accommodation-option').forEach(option => {
                option.classList.remove('selected');
            });
            
            // Re-select accommodation if it was pre-selected
            if (selectedAccommodation) {
                selectAccommodation(selectedAccommodation);
            } else {
                // Reset to default form (cottage settings)
                updateBookingFormForAccommodation('cottage');
            }
            
            // Reset form
            document.getElementById('bookingCheckin').value = '';
            document.getElementById('bookingCheckout').value = '';
            document.getElementById('bookingAdults').value = '2';
            document.getElementById('bookingChildren').value = '0';
            
            // Hide sections that should be hidden initially
            document.getElementById('pricingBreakdown').style.display = 'none';
            document.getElementById('guestDetailsSection').style.display = 'none';
            document.getElementById('instantPaymentSection').style.display = 'none';
            const availabilityResult = document.getElementById('availabilityResult');
            if (availabilityResult) availabilityResult.textContent = '';
        }

        window.selectAccommodation = function(accommodationType) {
            // Console statement removed for production
            selectedAccommodation = accommodationType;
            
            // Update UI
            document.querySelectorAll('.accommodation-option').forEach(option => {
                option.classList.remove('selected');
            });
            const selectedElement = document.querySelector(`[data-accommodation="${accommodationType}"]`);
            if (selectedElement) {
                selectedElement.classList.add('selected');
                // Console statement removed for production
            } else {
                // Console statement removed for production
            }
            
            // Update form based on accommodation type
            updateBookingFormForAccommodation(accommodationType);
            
            // Immediately scroll to dates section after accommodation selection
            setTimeout(() => {
                const datesSection = document.querySelector('.booking-date-row');
                if (datesSection) {
                    datesSection.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center'
                    });
                }
            }, 100);
        }
        
        function updateBookingFormForAccommodation(accommodationType) {
            const adultsSelect = document.getElementById('bookingAdults');
            const childrenSelect = document.getElementById('bookingChildren');
            const childrenGroup = childrenSelect.closest('.booking-form-group');
            const petSelectionGroup = document.getElementById('petSelectionGroup');
            const cottageWarning = document.getElementById('cottageMinimumStayWarning');
            
            if (accommodationType === 'dome-pinot' || accommodationType === 'dome-rose') {
                // Domes: Adults only (1-2), no children, no pets
                safeCreateSelectOptions(adultsSelect, [
                    {value: '1', text: '1 Adult'},
                    {value: '2', text: '2 Adults', selected: true}
                ]);
                
                // Hide children section for domes
                if (childrenGroup) {
                    childrenGroup.style.display = 'none';
                }
                
                // Hide pet option for domes
                if (petSelectionGroup) {
                    petSelectionGroup.style.display = 'none';
                    document.getElementById('bookingPets').value = '0';
                }
                
                // Set children to 0 for domes
                childrenSelect.value = '0';
                
                // Hide cottage minimum stay warning for domes
                if (cottageWarning) {
                    cottageWarning.style.display = 'none';
                }
                
                // Console statement removed for production
            } else {
                // Cottage: Maximum 4 people total, pets allowed
                safeCreateSelectOptions(adultsSelect, [
                    {value: '1', text: '1 Adult'},
                    {value: '2', text: '2 Adults', selected: true},
                    {value: '3', text: '3 Adults'},
                    {value: '4', text: '4 Adults'}
                ]);
                
                // Show children section for cottage (max 2 children to keep total at 4)
                if (childrenGroup) {
                    childrenGroup.style.display = 'block';
                    safeCreateSelectOptions(childrenSelect, [
                        {value: '0', text: '0 Children', selected: true},
                        {value: '1', text: '1 Child'},
                        {value: '2', text: '2 Children'}
                    ]);
                }
                
                // Show pet option for cottage
                if (petSelectionGroup) {
                    petSelectionGroup.style.display = 'block';
                }
                
                // Show cottage minimum stay warning
                if (cottageWarning) {
                    cottageWarning.style.display = 'block';
                }
                
                // Console statement removed for production
            }
        }

        function updateCheckoutMinDate() {
            const checkinDate = new Date(document.getElementById('bookingCheckin').value);
            if (checkinDate) {
                checkinDate.setDate(checkinDate.getDate() + 1);
                document.getElementById('bookingCheckout').min = checkinDate.toISOString().split('T')[0];
                
                // Clear checkout if it's before new minimum
                const checkoutInput = document.getElementById('bookingCheckout');
                if (checkoutInput.value && new Date(checkoutInput.value) <= new Date(document.getElementById('bookingCheckin').value)) {
                    checkoutInput.value = '';
                }
                
                // Check cottage minimum stay requirements
                validateCottageMinimumStay();
            }
        }

        function calculateNightsFrontend(checkIn, checkOut) {
            if (!checkIn || !checkOut) return 0;
            const checkInDate = new Date(checkIn);
            const checkOutDate = new Date(checkOut);
            const timeDifference = checkOutDate.getTime() - checkInDate.getTime();
            return Math.ceil(timeDifference / (1000 * 3600 * 24));
        }

        function isPeakSeason(date) {
            const month = new Date(date).getMonth() + 1; // JS months are 0-based
            return month >= 10 || month <= 5; // Oct (10) through May (5)
        }

        function validateCottageMinimumStay() {
            const checkIn = document.getElementById('bookingCheckin').value;
            const checkOut = document.getElementById('bookingCheckout').value;
            
            if (!checkIn || !checkOut || selectedAccommodation !== 'lakeside-cottage') {
                return true;
            }
            
            const nights = calculateNightsFrontend(checkIn, checkOut);
            const isPeak = isPeakSeason(checkIn);
            
            if (isPeak && nights < 2) {
                // Show error message
                showDateValidationError('Minimum 2-night stay required for Lakeside Cottage during peak season (October to May)');
                return false;
            } else {
                // Clear error message
                clearDateValidationError();
                return true;
            }
        }

        function showDateValidationError(message) {
            let errorDiv = document.getElementById('dateValidationError');
            if (!errorDiv) {
                errorDiv = document.createElement('div');
                errorDiv.id = 'dateValidationError';
                errorDiv.style.cssText = 'background: #fee2e2; border: 1px solid #ef4444; padding: 0.75rem; border-radius: 6px; margin: 0.5rem 0; color: #dc2626; font-size: 0.9rem;';
                
                const dateRow = document.querySelector('.booking-date-row');
                if (dateRow) {
                    dateRow.parentNode.insertBefore(errorDiv, dateRow.nextSibling);
                }
            }
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
        }

        function clearDateValidationError() {
            const errorDiv = document.getElementById('dateValidationError');
            if (errorDiv) {
                errorDiv.style.display = 'none';
            }
        }

        // INSTANT BOOKING: Combined availability check, pricing, and immediate payment
        async window.instantBookingWithPayment = function() {
            // Console statement removed for production
            // Console statement removed for production
            // Console statement removed for production
            // Console statement removed for production
            
            if (!selectedAccommodation) {
                // Console statement removed for production
                alert('Please select an accommodation type');
                return;
            }

            const checkin = document.getElementById('bookingCheckin').value;
            const checkout = document.getElementById('bookingCheckout').value;
            const adults = document.getElementById('bookingAdults').value;
            const children = document.getElementById('bookingChildren').value;
            const pets = document.getElementById('bookingPets') ? document.getElementById('bookingPets').value : '0';

            // Console statement removed for production

            if (!checkin || !checkout) {
                // Console statement removed for production
                alert('Please select both check-in and check-out dates');
                return;
            }

            const checkinDate = new Date(checkin);
            const checkoutDate = new Date(checkout);
            
            // Console statement removed for production
            
            if (checkoutDate <= checkinDate) {
                // Console statement removed for production
                alert('Check-out date must be after check-in date');
                return;
            }

            // Validate cottage minimum stay requirements
            if (!validateCottageMinimumStay()) {
                alert('Minimum 2-night stay required for Lakeside Cottage during peak season (October to May)');
                return;
            }

            // Store booking data
            bookingData = {
                accommodation: selectedAccommodation,
                checkin: checkin,
                checkout: checkout,
                adults: parseInt(adults),
                children: parseInt(children),
                pets: parseInt(pets),
                nights: Math.ceil((checkoutDate - checkinDate) / (1000 * 60 * 60 * 24))
            };

            // Console statement removed for production

            // Show loading state
            const availabilityResult = document.getElementById('availabilityResult');
            if (window.SecureFrontend) {
          window.SecureFrontend.safeSetInnerHTML(availabilityResult, '<div style="text-align: center;">Checking availability and calculating pricing <span class="loading-spinner"></span></div>');
        } else {
          availabilityResult.textContent = 'Checking availability and calculating pricing...';
        }

            // Console statement removed for production

            // Simulate API call to Uplisting
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Mock availability check (90% chance of availability)
            const isAvailable = Math.random() > 0.1;
            
            // Console statement removed for production
            
            if (isAvailable) {
                // Console statement removed for production
                calculatePricingWithGST();
                updateSelectedDetails();
                if (window.SecureFrontend) {
          window.SecureFrontend.updateAvailabilityResult('Available for Instant Booking! Your selected dates are available. Complete your booking below.', true);
        } else {
          availabilityResult.textContent = '✅ Available for Instant Booking! Your selected dates are available. Complete your booking below.';
        }
                document.getElementById('pricingBreakdown').style.display = 'block';
                document.getElementById('guestDetailsSection').style.display = 'block';
                document.getElementById('instantPaymentSection').style.display = 'block';
                
                // Move to step 2 to show the booking details
                goToBookingStep(2);
                
                // Console statement removed for production
                // Console statement removed for production
            } else {
                if (window.SecureFrontend) {
          window.SecureFrontend.updateAvailabilityResult('Not Available. These dates are not available. Please try different dates.', false);
        } else {
          availabilityResult.textContent = '❌ Not Available. These dates are not available. Please try different dates.';
        }
                document.getElementById('pricingBreakdown').style.display = 'none';
                document.getElementById('guestDetailsSection').style.display = 'none';
                document.getElementById('instantPaymentSection').style.display = 'none';
            }
        }

        // ENHANCED PRICING CALCULATION WITH NZ GST
        function calculatePricingWithGST() {
            const rates = accommodationRates[selectedAccommodation];
            
            // Determine rate type based on season (mock logic)
            const checkinDate = new Date(bookingData.checkin);
            const month = checkinDate.getMonth();
            let rateType = 'base';
            if (month >= 11 || month <= 2) rateType = 'peak'; // Summer
            if (month >= 5 && month <= 8) rateType = 'offPeak'; // Winter
            
            const nightlyRate = rates[rateType];
            let subtotal = nightlyRate * bookingData.nights;
            
            // Calculate extra guest charges for cottage (beyond 2 people)
            let extraGuestCharge = 0;
            if (selectedAccommodation === 'lakeside-cottage') {
                const totalGuests = bookingData.adults + bookingData.children;
                if (totalGuests > 2) {
                    const extraGuests = totalGuests - 2;
                    extraGuestCharge = extraGuests * 100 * bookingData.nights; // $100 per extra guest per night
                    subtotal += extraGuestCharge;
                }
            }
            
            // Calculate pet fees for cottage
            let petFee = 0;
            if (selectedAccommodation === 'lakeside-cottage' && bookingData.pets > 0) {
                petFee = bookingData.pets * 25 * bookingData.nights; // $25 per pet per night
                subtotal += petFee;
            }
            
            const cleaningFee = 75;
            const serviceFee = Math.round(subtotal * 0.03); // 3% service fee
            
            // Calculate total (all prices already include GST)
            const total = subtotal + cleaningFee + serviceFee;
            // GST is already included in all prices (15% of total)
            const gst = Math.round(total * 0.13); // GST portion is 15/115 = 13% of GST-inclusive price

            // Update booking data
            bookingData.nightlyRate = nightlyRate;
            bookingData.subtotal = subtotal;
            bookingData.extraGuestCharge = extraGuestCharge;
            bookingData.petFee = petFee;
            bookingData.cleaningFee = cleaningFee;
            bookingData.serviceFee = serviceFee;
            bookingData.gst = gst;
            bookingData.total = total;

            // Update UI with NZD formatting
            document.getElementById('accommodationRate').textContent = `${nightlyRate} NZD`;
            document.getElementById('numberOfNights').textContent = bookingData.nights;
            document.getElementById('subtotal').textContent = `${subtotal} NZD`;
            
            // Show/hide extra guest charge for cottage
            const extraGuestRow = document.getElementById('extraGuestRow');
            const extraGuestChargeElement = document.getElementById('extraGuestCharge');
            if (selectedAccommodation === 'lakeside-cottage' && extraGuestCharge > 0) {
                extraGuestRow.style.display = 'flex';
                extraGuestChargeElement.textContent = `${extraGuestCharge} NZD`;
            } else {
                extraGuestRow.style.display = 'none';
                extraGuestChargeElement.textContent = '$0';
            }
            
            // Show/hide pet fee for cottage
            const petFeeRow = document.getElementById('petFeeRow');
            const petFeeElement = document.getElementById('petFee');
            if (selectedAccommodation === 'lakeside-cottage' && petFee > 0) {
                if (petFeeRow) {
                    petFeeRow.style.display = 'flex';
                    petFeeElement.textContent = `${petFee} NZD`;
                }
            } else {
                if (petFeeRow) {
                    petFeeRow.style.display = 'none';
                    petFeeElement.textContent = '$0';
                }
            }
            
            document.getElementById('cleaningFee').textContent = `${cleaningFee} NZD`;
            document.getElementById('serviceFee').textContent = `${serviceFee} NZD`;
            document.getElementById('gst').textContent = `${gst} NZD`;
            document.getElementById('totalAmount').textContent = `${total} NZD`;
        }

        // SECURE PAYMENT: Process payment securely with Stripe
        async function processInstantPayment() {
            try {
                // Validate guest details are filled
                const firstName = document.getElementById('guestFirstName').value;
                const lastName = document.getElementById('guestLastName').value;
                const emailInput = document.getElementById('guestEmail');
                const phone = document.getElementById('guestPhone').value;

                // Validate email
                if (!validateEmail(emailInput)) {
                    return;
                }

                if (!firstName || !lastName || !phone) {
                    alert('Please fill in all required guest information');
                    return;
                }

                // Use secure payment processing if available
                if (window.SecurePayment && window.SecurePayment.processSecurePaymentFromForm) {
                    await window.SecurePayment.processSecurePaymentFromForm();
                } else {
                    // Fallback to secure API call
                    const bookingData = {
                        accommodation: selectedAccommodation,
                        checkIn: document.getElementById('bookingCheckin').value,
                        checkOut: document.getElementById('bookingCheckout').value,
                        guests: document.getElementById('bookingAdults').value,
                        guestName: firstName + ' ' + lastName,
                        guestEmail: emailInput.value,
                        guestPhone: phone,
                        specialRequests: document.getElementById('specialRequests').value
                    };

                    // Sanitize data if secure functions available
                    if (window.SecureFrontend && window.SecureFrontend.sanitizeFormData) {
                        const formData = new FormData();
                        Object.keys(bookingData).forEach(key => {
                            formData.append(key, bookingData[key]);
                        });
                        const sanitizedData = window.SecureFrontend.sanitizeFormData(formData);
                        Object.assign(bookingData, sanitizedData);
                    }

                    // Process payment securely
                    const response = await fetch('/api/process-booking', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': await getCSRFToken()
                        },
                        credentials: 'include',
                        body: JSON.stringify(bookingData)
                    });

                    if (!response.ok) {
                        throw new Error('Payment processing failed');
                    }

                    const result = await response.json();
                    
                    // Show success
                    if (window.SecureFrontend && window.SecureFrontend.showSuccess) {
                        window.SecureFrontend.showSuccess('Payment processed successfully! Your booking is confirmed.');
                    } else {
                        alert('Payment processed successfully! Your booking is confirmed.');
                    }

                    // Close modal and redirect
                    setTimeout(() => {
                        closeBookingModal();
                        showPage('home');
                    }, 2000);
                }
                
            } catch (error) {
                // Console statement removed for production
                
                if (window.SecureFrontend && window.SecureFrontend.handleSecurityError) {
                    window.SecureFrontend.handleSecurityError(error, 'payment_processing');
                } else {
                    alert('Payment processing failed. Please try again.');
                }
            }
        }

        // Process booking with Uplisting after successful payment
        async function processBookingWithUplisting() {
            const paymentButton = document.getElementById('instantPaymentBtn');
            safeSetContent('instantPaymentBtn', 'Creating Booking with Uplisting', true);
            // Add loading spinner safely
            const spinner = document.createElement('span');
            spinner.className = 'loading-spinner';
            paymentButton.appendChild(spinner);

            // Simulate Uplisting API call
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Mock successful booking
            const bookingReference = 'LR' + Date.now().toString().slice(-6);
            
            // Show success message securely
            if (window.SecureFrontend && window.SecureFrontend.updateBookingResult) {
                window.SecureFrontend.updateBookingResult(true, 'Instant Booking Confirmed! Thank you for choosing Lakeside Retreat. Your booking has been instantly confirmed and you\'ll receive a confirmation email shortly.');
            } else {
                const bookingResultSection = document.getElementById('bookingResultSection');
                const successDiv = document.createElement('div');
                successDiv.className = 'booking-success';
                // Create success content safely without innerHTML
                const iconDiv = document.createElement('div');
                iconDiv.className = 'success-icon';
                iconDiv.textContent = '✅';
                
                const heading = document.createElement('h3');
                heading.style.color = 'var(--brand-teal)';
                heading.style.marginBottom = '1rem';
                heading.textContent = 'Instant Booking Confirmed!';
                
                const description = document.createElement('p');
                description.textContent = 'Thank you for choosing Lakeside Retreat. Your booking has been instantly confirmed and you\'ll receive a confirmation email shortly.';
                
                const detailsDiv = document.createElement('div');
                detailsDiv.style.background = '#FAF4F5';
                detailsDiv.style.padding = '1rem';
                detailsDiv.style.borderRadius = '10px';
                detailsDiv.style.margin = '1.5rem 0';
                
                // Create detail paragraphs with safe text content
                const refP = document.createElement('p');
                refP.innerHTML = '<strong>Booking Reference:</strong> ';
                refP.appendChild(document.createTextNode(sanitizeHTML(bookingReference)));
                
                const totalP = document.createElement('p');
                totalP.innerHTML = '<strong>Total Paid (incl. GST):</strong> ';
                totalP.appendChild(document.createTextNode(sanitizeHTML(bookingData.total + ' NZD')));
                
                const methodP = document.createElement('p');
                methodP.innerHTML = '<strong>Payment Method:</strong> Credit Card via Stripe';
                
                const emailP = document.createElement('p');
                emailP.innerHTML = '<strong>Confirmation sent to:</strong> ';
                emailP.appendChild(document.createTextNode(sanitizeHTML(document.getElementById('guestEmail').value)));
                
                detailsDiv.appendChild(refP);
                detailsDiv.appendChild(totalP);
                detailsDiv.appendChild(methodP);
                detailsDiv.appendChild(emailP);
                
                const closeButton = document.createElement('button');
                closeButton.className = 'btn btn-primary';
                closeButton.style.marginTop = '1rem';
                closeButton.textContent = 'Close & Plan Your Stay';
                closeButton.onclick = closeBookingModal;
                
                successDiv.appendChild(iconDiv);
                successDiv.appendChild(heading);
                successDiv.appendChild(description);
                successDiv.appendChild(detailsDiv);
                successDiv.appendChild(closeButton);
                bookingResultSection.textContent = '';
                bookingResultSection.appendChild(successDiv);
            }

            // Hide the payment section
            document.getElementById('instantPaymentSection').style.display = 'none';
            paymentButton.parentElement.style.display = 'none';

            // In real implementation, this would:
            // 1. Process payment through Stripe API
            // 2. Create booking in Uplisting via API
            // 3. Send confirmation emails
            // 4. Update calendar availability
            // 5. Sync with all booking platforms
        }

        function updateSelectedDetails() {
            const checkinDate = new Date(bookingData.checkin);
            const checkoutDate = new Date(bookingData.checkout);
            
            document.getElementById('selectedDetailsDisplay').innerHTML = `
                <h4 style="color: var(--brand-teal); margin-bottom: 0.5rem;">Selected Energy-Positive Experience</h4>
                <p><strong>Accommodation:</strong> ${accommodationNames[selectedAccommodation]}</p>
                <p><strong>Check-in:</strong> ${checkinDate.toLocaleDateString()} | <strong>Check-out:</strong> ${checkoutDate.toLocaleDateString()}</p>
                <p><strong>Guests:</strong> ${bookingData.adults} Adults${bookingData.children > 0 ? `, ${bookingData.children} Children` : ''}${bookingData.pets > 0 ? `, ${bookingData.pets} Pet${bookingData.pets > 1 ? 's' : ''}` : ''}</p>
                <p><strong>Duration:</strong> ${bookingData.nights} night${bookingData.nights > 1 ? 's' : ''}</p>
                <p style="color: #10b981; font-weight: 600;">✓ Powered by 16.72kW commercial-grade solar system</p>
            `;
        }

        window.goToBookingStep = function(stepNumber) {
            currentBookingStep = stepNumber;
            
            // Hide all steps
            document.querySelectorAll('.booking-step').forEach(step => {
                step.classList.remove('active');
            });
            
            // Show selected step
            document.getElementById(`bookingStep${stepNumber}`).classList.add('active');

            // Update progress indicator
            document.querySelectorAll('.progress-step').forEach((step, index) => {
                const stepNum = index + 1;
                if (stepNum < stepNumber) {
                    step.classList.add('completed');
                    step.classList.remove('active');
                } else if (stepNum === stepNumber) {
                    step.classList.add('active');
                    step.classList.remove('completed');
                } else {
                    step.classList.remove('active', 'completed');
                }
            });

            // Update progress bars
            document.querySelectorAll('.progress-bar').forEach((bar, index) => {
                if (index + 1 < stepNumber) {
                    bar.classList.add('completed');
                } else {
                    bar.classList.remove('completed');
                }
            });

            // Update final booking summary if going to step 3
            if (stepNumber === 3) {
                updateFinalSummary();
            }
        }

        function updateFinalSummary() {
            const checkinDate = new Date(bookingData.checkin);
            const checkoutDate = new Date(bookingData.checkout);
            
            // Update booking summary
            document.getElementById('finalAccommodationName').textContent = accommodationNames[selectedAccommodation];
            document.getElementById('finalDates').textContent = `${checkinDate.toLocaleDateString()} - ${checkoutDate.toLocaleDateString()}`;
            document.getElementById('finalGuests').textContent = `${bookingData.adults} Adults${bookingData.children > 0 ? `, ${bookingData.children} Children` : ''}`;
            document.getElementById('finalNights').textContent = `${bookingData.nights} night${bookingData.nights > 1 ? 's' : ''}`;
            
            // Update price breakdown
            document.getElementById('finalAccommodationRate').textContent = `$${bookingData.nightlyRate}`;
            document.getElementById('finalNumberOfNights').textContent = bookingData.nights;
            document.getElementById('finalSubtotal').textContent = `$${bookingData.subtotal}`;
            document.getElementById('finalCleaningFee').textContent = `$${bookingData.cleaningFee}`;
            document.getElementById('finalServiceFee').textContent = `$${bookingData.serviceFee}`;
            
            // Show/hide optional fees
            const finalExtraGuestRow = document.getElementById('finalExtraGuestRow');
            const finalPetFeeRow = document.getElementById('finalPetFeeRow');
            
            if (bookingData.extraGuestCharge && bookingData.extraGuestCharge > 0) {
                finalExtraGuestRow.style.display = 'flex';
                document.getElementById('finalExtraGuestFee').textContent = `$${bookingData.extraGuestCharge}`;
            } else {
                finalExtraGuestRow.style.display = 'none';
            }
            
            if (bookingData.petFee && bookingData.petFee > 0) {
                finalPetFeeRow.style.display = 'flex';
                document.getElementById('finalPetFee').textContent = `$${bookingData.petFee}`;
            } else {
                finalPetFeeRow.style.display = 'none';
            }
            
            document.getElementById('finalGST').textContent = `$${bookingData.gst}`;
            document.getElementById('finalTotalAmount').textContent = `$${bookingData.total}`;
        }

        // Validate guest details before proceeding to step 3
        window.validateGuestDetailsAndContinue = function() {
            // Collect guest data for validation
            const guestData = {
                firstName: document.getElementById('guestFirstName').value.trim(),
                lastName: document.getElementById('guestLastName').value.trim(),
                email: document.getElementById('guestEmail').value.trim(),
                phone: document.getElementById('guestPhone').value.trim()
            };

            // Validate required fields first with visual feedback
            let hasErrors = false;
            
            if (!guestData.firstName) {
                showFormError('guestFirstName', 'First name is required');
                hasErrors = true;
            }
            
            if (!guestData.lastName) {
                showFormError('guestLastName', 'Last name is required');
                hasErrors = true;
            }
            
            if (!guestData.email) {
                showFormError('guestEmail', 'Email address is required');
                hasErrors = true;
            }
            
            if (!guestData.phone) {
                showFormError('guestPhone', 'Phone number is required');
                hasErrors = true;
            } else {
                // Validate phone format if provided
                const phoneInput = document.getElementById('guestPhone');
                if (!validatePhoneNumber(phoneInput)) {
                    showFormError('guestPhone', 'Please enter a valid phone number (7-15 digits)');
                    hasErrors = true;
                }
            }
            
            if (hasErrors) {
                return;
            }

            // Validate email format
            const emailInput = document.getElementById('guestEmail');
            if (!validateEmail(emailInput)) {
                showFormError('guestEmail', 'Please enter a valid email address');
                return;
            }

            // If all validation passes, proceed to step 3
            goToBookingStep(3);
        }

        // BUTTON 3: Process booking and show confirmation
        async window.processBookingAndConfirm = function() {
            // Collect guest data
            const guestData = {
                firstName: document.getElementById('guestFirstName').value,
                lastName: document.getElementById('guestLastName').value,
                email: document.getElementById('guestEmail').value,
                phone: document.getElementById('guestPhone').value,
                specialRequests: document.getElementById('specialRequests').value
            };

            // Validate required fields first
            if (!guestData.firstName || !guestData.lastName || !guestData.email || !guestData.phone) {
                alert('Please fill in all required fields');
                return;
            }

            // Validate email format
            const emailInput = document.getElementById('guestEmail');
            if (!validateEmail(emailInput)) {
                return;
            }

            // Update button state
            const button = event.target;
            button.innerHTML = 'Processing Booking with Uplisting <span class="loading-spinner"></span>';
            button.disabled = true;

            // Simulate booking API call to Uplisting
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Mock successful booking
            const bookingReference = 'LR' + Date.now().toString().slice(-6);
            
            // Show success directly in step 3
            document.getElementById('bookingResultSection').innerHTML = `
                <div class="booking-success">
                    <div class="success-icon">✅</div>
                    <h3 style="color: var(--brand-teal); margin-bottom: 1rem;">Booking Confirmed!</h3>
                    <p>Thank you for choosing Lakeside Retreat. You'll receive a confirmation email shortly with all the details for your stay.</p>
                    <div style="background: #FAF4F5; padding: 1rem; border-radius: 10px; margin: 1.5rem 0;">
                        <p><strong>Booking Reference:</strong> ${bookingReference}</p>
                        <p><strong>Total Paid (incl. GST):</strong> ${bookingData.total} NZD</p>
                        <p><strong>Confirmation sent to:</strong> ${guestData.email}</p>
                    </div>
                    <button class="btn btn-primary" onclick="closeBookingModal()" style="margin-top: 1rem;">Close & Plan Your Stay</button>
                </div>
            `;

            // Hide the back/confirm buttons
            button.parentElement.style.display = 'none';

            // In real implementation, this would:
            // 1. Process payment through Stripe/PayPal
            // 2. Create booking in Uplisting via API
            // 3. Send confirmation emails
            // 4. Update calendar availability
            // 5. Sync with all booking platforms
        }

        // === EMAIL VALIDATION FUNCTIONS ===

        window.validateEmail = function(input) {
            const email = input.value.trim();
            const errorElement = document.getElementById(input.id + 'Error');
            
            // Email regex pattern
            const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
            
            // Clear previous error
            if (errorElement) {
                errorElement.style.display = 'none';
                input.style.borderColor = '';
            }
            
            // Check if email is empty
            if (!email) {
                if (errorElement) {
                    errorElement.textContent = 'Please enter your email address';
                    errorElement.style.display = 'block';
                    input.style.borderColor = '#dc2626';
                }
                return false;
            }
            
            // Check email format
            if (!emailPattern.test(email)) {
                if (errorElement) {
                    errorElement.textContent = 'Please enter a valid email address (e.g., yourname@example.com)';
                    errorElement.style.display = 'block';
                    input.style.borderColor = '#dc2626';
                }
                return false;
            }
            
            // Check for common mistakes
            if (email.includes('..') || email.includes('@@') || email.startsWith('.') || email.endsWith('.')) {
                if (errorElement) {
                    errorElement.textContent = 'Please check your email address format';
                    errorElement.style.display = 'block';
                    input.style.borderColor = '#dc2626';
                }
                return false;
            }
            
            // Check domain
            const domain = email.split('@')[1];
            if (!domain || domain.length < 3) {
                if (errorElement) {
                    errorElement.textContent = 'Please enter a valid email domain';
                    errorElement.style.display = 'block';
                    input.style.borderColor = '#dc2626';
                }
                return false;
            }
            
            // Email is valid
            if (errorElement) {
                errorElement.style.display = 'none';
                input.style.borderColor = '#10b981';
            }
            return true;
        }

        function clearEmailError(input) {
            const errorElement = document.getElementById(input.id + 'Error');
            if (errorElement) {
                errorElement.style.display = 'none';
                input.style.borderColor = '';
            }
        }

        // Form validation helper functions
        function showFormError(fieldId, message) {
            const input = document.getElementById(fieldId);
            const errorElement = document.getElementById(fieldId + 'Error');
            
            if (input) {
                input.classList.add('error');
            }
            
            if (errorElement) {
                errorElement.textContent = message;
                errorElement.classList.add('show');
            }
        }

        function clearFormError(fieldId) {
            const input = document.getElementById(fieldId);
            const errorElement = document.getElementById(fieldId + 'Error');
            
            if (input) {
                input.classList.remove('error');
            }
            
            if (errorElement) {
                errorElement.classList.remove('show');
            }
        }

        // Phone number validation function
        function validatePhoneNumber(input) {
            const phone = input.value.trim();
            
            // Allow empty for optional fields
            if (!phone) return true;
            
            // Remove all non-digit characters to count actual numbers
            const digitsOnly = phone.replace(/\D/g, '');
            
            // Check minimum and maximum length
            if (digitsOnly.length < 7) {
                return false;
            }
            
            if (digitsOnly.length > 15) {
                return false;
            }
            
            // Check for common valid patterns (basic format check)
            // Allows: +64 3 123 4567, (03) 123-4567, 021 123 456, 0312341234, etc.
            const phonePattern = /^[\+]?[\d\s\-\(\)]{7,20}$/;
            
            if (!phonePattern.test(phone)) {
                return false;
            }
            
            return true;
        }

        // Phone field validation with error display
        function validatePhoneField(input) {
            const phone = input.value.trim();
            
            if (!phone) {
                // Don't show error for empty field during blur, will be caught on submit
                return true;
            }
            
            if (!validatePhoneNumber(input)) {
                showFormError('guestPhone', 'Please enter a valid phone number (7-15 digits)');
                return false;
            } else {
                clearFormError('guestPhone');
                return true;
            }
        }

        // Auto-scroll to booking button when date fields are focused
        function scrollToBookingButton() {
            // Small delay to allow date picker to open first
            setTimeout(() => {
                // Find the "Check Availability & Book Instantly" button
                const bookingButton = document.querySelector('button[onclick="instantBookingWithPayment()"]');
                
                if (bookingButton) {
                    bookingButton.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center'
                    });
                }
            }, 300);
        }

        // === CONTACT FORM EMAIL HANDLER ===
        
        async function sendContactMessage(event) {
            event.preventDefault();
            
            const submitBtn = document.getElementById('contactSubmitBtn');
            const statusDiv = document.getElementById('contactFormStatus');
            
            // Get form values
            const name = document.getElementById('contactName').value.trim();
            const email = document.getElementById('contactEmail').value.trim();
            const message = document.getElementById('contactMessage').value.trim();
            
            // Validate email
            const emailInput = document.getElementById('contactEmail');
            if (!validateEmail(emailInput)) {
                return;
            }
            
            // Update button state
            submitBtn.disabled = true;
            submitBtn.innerHTML = 'Sending... <span class="loading-spinner"></span>';
            
            try {
                // Check if backend server is available
                const backendUrl = window.location.hostname === 'localhost' 
                    ? 'http://localhost:3000' 
                    : window.location.origin;
                
                // Send to backend API
                const response = await fetch(`${backendUrl}/api/contact`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        name: name,
                        email: email,
                        message: message,
                        timestamp: new Date().toISOString()
                    })
                });
                
                if (response.ok) {
                    // Success
                    statusDiv.style.display = 'block';
                    statusDiv.style.color = '#10b981';
                    statusDiv.innerHTML = '✅ Message sent successfully! We\'ll get back to you within 24 hours.';
                    
                    // Reset form
                    document.getElementById('contactForm').reset();
                    
                    // Hide status after 5 seconds
                    setTimeout(() => {
                        statusDiv.style.display = 'none';
                    }, 5000);
                } else {
                    throw new Error('Failed to send message');
                }
                
            } catch (error) {
                // Fallback to mailto if backend is not available
                const subject = encodeURIComponent('Website Contact from ' + name);
                const body = encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`);
                const mailtoLink = `mailto:info@lakesideretreat.co.nz?subject=${subject}&body=${body}`;
                
                // Open mailto link
                window.location.href = mailtoLink;
                
                // Show fallback message
                statusDiv.style.display = 'block';
                statusDiv.style.color = '#f59e0b';
                statusDiv.innerHTML = '📧 Opening your email client to send message...';
                
                // Reset form after short delay
                setTimeout(() => {
                    document.getElementById('contactForm').reset();
                    statusDiv.style.display = 'none';
                }, 3000);
            } finally {
                // Reset button
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Send Message';
            }
        }

        // === ORIGINAL WEBSITE FUNCTIONS ===

        window.showPage = function(pageName) {
            document.querySelectorAll('.page').forEach(page => {
                page.classList.remove('active');
            });

            const pageElement = document.getElementById(pageName + 'Page');
            if (pageElement) {
                pageElement.classList.add('active');
            }

            document.querySelectorAll('.nav-link').forEach(link => {
                link.classList.remove('active');
            });

            const activeLink = document.querySelector(`[onclick="showPage('${pageName}')"]`);
            if (activeLink && activeLink.classList.contains('nav-link')) {
                activeLink.classList.add('active');
            }

            currentPage = pageName;

            // Initialize carousels when stay page is shown
            if (pageName === 'stay') {
                initializeCarousels();
            }
            
            // FORCE scroll to top - multiple methods for reliability
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
            window.scrollTo(0, 0);
            
            // Also try smooth scroll
            setTimeout(() => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }, 50);
            
            trackPageView(pageName);
        }

        function showLegalPage(legalType) {
            // Create modal for legal pages
            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.8);
                z-index: 10000;
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 20px;
            `;

            const legalContent = {
                terms: {
                    title: 'Terms & Conditions',
                    content: `
                        <h2>Terms & Conditions</h2>
                        <p><strong>Last updated: January 2024</strong></p>
                        
                        <h3>1. Booking & Payment</h3>
                        <p>All bookings require a valid credit card for reservation. Payment is processed through Stripe for secure transactions. Full payment is required at time of booking unless otherwise specified.</p>
                        
                        <h3>2. Cancellation Policy</h3>
                        <p>Cancellations made 14 days or more before arrival receive a full refund. Cancellations within 14 days are non-refundable. No-shows will be charged the full amount.</p>
                        
                        <h3>3. Check-in & Check-out</h3>
                        <p>Check-in is available from 3:00 PM. Check-out is required by 10:00 AM. Early check-in or late check-out may be available upon request and subject to availability.</p>
                        
                        <h3>4. Guest Responsibilities</h3>
                        <p>Guests are responsible for the accommodation during their stay. Any damage or excessive cleaning required will be charged to the guest's account. Smoking is not permitted inside any accommodation.</p>
                        
                        <h3>5. Pet Policy</h3>
                        <p>Pets are welcome in Lakeside Cottage only, subject to prior approval. A pet fee of $50 per stay applies. Pets must be well-behaved and not left unattended.</p>
                        
                        <h3>6. Solar System</h3>
                        <p>Our accommodation is powered by a commercial-grade solar system. While we maintain 99.9% uptime, we cannot guarantee uninterrupted power supply. No refunds will be given for power-related issues.</p>
                    `
                },
                privacy: {
                    title: 'Privacy Policy',
                    content: `
                        <h2>Privacy Policy</h2>
                        <p><strong>Last updated: January 2024</strong></p>
                        
                        <h3>1. Information We Collect</h3>
                        <p>We collect information you provide directly to us, such as when you make a booking, contact us, or sign up for our newsletter. This may include your name, email address, phone number, and payment information.</p>
                        
                        <h3>2. How We Use Your Information</h3>
                        <p>We use the information we collect to process your bookings, communicate with you about your stay, send you marketing materials (with your consent), and improve our services.</p>
                        
                        <h3>3. Information Sharing</h3>
                        <p>We do not sell, trade, or otherwise transfer your personal information to third parties except as described in this policy. We may share information with our booking partners (Uplisting) and payment processors (Stripe) as necessary to provide our services.</p>
                        
                        <h3>4. Data Security</h3>
                        <p>We implement appropriate security measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction.</p>
                        
                        <h3>5. Cookies</h3>
                        <p>We use cookies to enhance your browsing experience and analyze website traffic. You can control cookie settings through your browser preferences.</p>
                        
                        <h3>6. Your Rights</h3>
                        <p>You have the right to access, correct, or delete your personal information. Contact us at info@lakesideretreat.co.nz to exercise these rights.</p>
                    `
                },
                booking: {
                    title: 'Booking Policy',
                    content: `
                        <h2>Booking Policy</h2>
                        <p><strong>Last updated: January 2024</strong></p>
                        
                        <h3>1. Reservation Process</h3>
                        <p>All bookings are confirmed immediately upon payment processing. You will receive a confirmation email with booking details and arrival instructions within 24 hours.</p>
                        
                        <h3>2. Payment Methods</h3>
                        <p>We accept all major credit cards through our secure Stripe payment system. Payment is processed in New Zealand Dollars (NZD).</p>
                        
                        <h3>3. Rate Information</h3>
                        <p>Rates are subject to change without notice. The rate confirmed at time of booking is guaranteed for your stay. Rates include GST (Goods and Services Tax).</p>
                        
                        <h3>4. Occupancy Limits</h3>
                        <p>Dome Pinot & Dome Rosé: Maximum 2 adults, no children permitted. Lakeside Cottage: Maximum 3 guests, children and pets welcome.</p>
                        
                        <h3>5. Minimum Stay Requirements</h3>
                        <p>Minimum 2-night stay applies to Lakeside Cottage during peak season (October to May). Single night bookings may be available during off-peak periods for all accommodations.</p>
                        
                        <h3>6. Special Requests</h3>
                        <p>Special requests (early check-in, late check-out, dietary requirements) should be made at time of booking. We will accommodate requests where possible but cannot guarantee availability.</p>
                    `
                },
                cancellation: {
                    title: 'Cancellation Policy',
                    content: `
                        <h2>Cancellation Policy</h2>
                        <p><strong>Last updated: January 2024</strong></p>
                        
                        <h3>1. Standard Cancellation</h3>
                        <p>Cancellations made 14 days or more before your scheduled arrival date will receive a full refund minus a $50 processing fee.</p>
                        
                        <h3>2. Late Cancellation</h3>
                        <p>Cancellations made within 14 days of arrival are non-refundable. We recommend travel insurance to protect against unforeseen circumstances.</p>
                        
                        <h3>3. No-Show Policy</h3>
                        <p>Guests who do not arrive on their scheduled check-in date without prior notice will be charged the full amount of their booking.</p>
                        
                        <h3>4. Weather & Natural Events</h3>
                        <p>No refunds will be given for weather-related cancellations or natural events. We recommend travel insurance for protection against such events.</p>
                        
                        <h3>5. COVID-19 Policy</h3>
                        <p>If you are unable to travel due to COVID-19 restrictions, we will offer a full refund or credit for a future stay. Proof of restriction may be required.</p>
                        
                        <h3>6. Modification Requests</h3>
                        <p>Date changes are subject to availability and may incur additional charges. Contact us directly to discuss modification options.</p>
                    `
                },
                safety: {
                    title: 'Health & Safety Policy',
                    content: `
                        <h2>Health & Safety Policy</h2>
                        <p><strong>Last updated: January 2024</strong></p>
                        
                        <h3>1. Fire Safety</h3>
                        <p>All accommodations are equipped with smoke detectors, fire extinguishers, and emergency evacuation plans posted in each unit. Guests must familiarize themselves with emergency exit routes upon arrival.</p>
                        
                        <h3>2. Electrical Safety</h3>
                        <p>Our solar power system is professionally installed and regularly maintained. Report any electrical concerns immediately. Do not use unauthorized electrical equipment.</p>
                        
                        <h3>3. Water Safety</h3>
                        <p>Lake access is provided but guests swim at their own risk. No lifeguard on duty. Children must be supervised at all times near water. Hot tubs and spas must be used responsibly.</p>
                        
                        <h3>4. Emergency Procedures</h3>
                        <p>In case of emergency, dial 111. Emergency contact details are provided in each accommodation. Stephen & Sandy are available 24/7 for urgent assistance: +64 21 368 682</p>
                        
                        <h3>5. Building Safety</h3>
                        <p>All buildings comply with New Zealand Building Code requirements. Regular safety inspections are conducted. Report any maintenance issues immediately.</p>
                        
                        <h3>6. First Aid</h3>
                        <p>Basic first aid supplies are available in each accommodation. For serious medical emergencies, contact emergency services immediately.</p>
                    `
                },
                accessibility: {
                    title: 'Accessibility Information',
                    content: `
                        <h2>Accessibility Information</h2>
                        <p><strong>Last updated: January 2024</strong></p>
                        
                        <h3>1. Physical Access</h3>
                        <p>Our property has natural terrain with some sloped areas. Dome accommodations have steps and are not wheelchair accessible. The Lakeside Cottage has level access and wider doorways for easier mobility.</p>
                        
                        <h3>2. Parking</h3>
                        <p>Designated parking spaces are available close to all accommodations. Cottage guests have garage access for weather protection.</p>
                        
                        <h3>3. Communication Support</h3>
                        <p>We welcome guests with hearing or speech impairments. Email communication is available for all booking and service requests. Visual aids and written instructions can be provided upon request.</p>
                        
                        <h3>4. Service Animals</h3>
                        <p>Registered service animals are welcome in all accommodations at no additional charge. Please notify us at booking to ensure appropriate preparations.</p>
                        
                        <h3>5. Special Requirements</h3>
                        <p>We are committed to reasonable accommodations for guests with disabilities. Please contact us before booking to discuss specific needs and ensure we can provide appropriate support.</p>
                        
                        <h3>6. Local Accessibility Services</h3>
                        <p>Information about accessible attractions, restaurants, and services in Central Otago can be provided. We work with local operators to ensure inclusive experiences.</p>
                    `
                }
            };

            const content = legalContent[legalType];
            if (!content) return;

            modal.innerHTML = `
                <div style="background: white; max-width: 800px; max-height: 90vh; overflow-y: auto; border-radius: 15px; padding: 2rem; position: relative;">
                    <button onclick="closeLegalModal()" style="position: absolute; top: 1rem; right: 1rem; background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #666;">&times;</button>
                    <div style="color: #333; line-height: 1.6;">
                        ${content.content}
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            
            // Store current scroll position
            modal.dataset.scrollPosition = window.pageYOffset;
            
            // Close modal when clicking outside
            modal.addEventListener('click', function(e) {
                if (e.target === modal) {
                    closeLegalModal();
                }
            });
        }

        function closeLegalModal() {
            const modal = document.querySelector('div[style*="position: fixed"][style*="z-index: 10000"]');
            if (modal) {
                const scrollPosition = modal.dataset.scrollPosition || window.pageYOffset;
                modal.remove();
                // Restore scroll position to prevent jumping to top
                window.scrollTo(0, parseInt(scrollPosition));
            }
        }


        window.scrollToSection = function(sectionId) {
            const section = document.getElementById(sectionId);
            if (section) {
                section.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center' 
                });
            }
        }

        function scrollToAccommodations() {
            // Find the "Three Unique Experiences" section
            const accommodationsSection = document.querySelector('h2.section-title');
            if (accommodationsSection && accommodationsSection.textContent.includes('Three Unique Experiences')) {
                accommodationsSection.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'start' 
                });
            }
        }

        window.toggleGuide = function(headerElement) {
            const guideItem = headerElement.closest('.guide-item');
            const guideContent = guideItem.querySelector('.guide-content');
            const arrow = headerElement.querySelector('.guide-arrow');
            
            if (guideContent.style.maxHeight && guideContent.style.maxHeight !== '0px') {
                // Close the guide
                guideContent.style.maxHeight = '0px';
                arrow.style.transform = 'rotate(0deg)';
            } else {
                // Open the guide
                guideContent.style.maxHeight = guideContent.scrollHeight + 'px';
                arrow.style.transform = 'rotate(180deg)';
            }
        }

        window.toggleMobileMenu = function() {
            const mobileNav = document.getElementById('mobileNav');
            mobileNav.classList.toggle('active');
            
            if (mobileNav.classList.contains('active')) {
                document.body.style.overflow = 'hidden';
            } else {
                document.body.style.overflow = '';
            }
        }

        function handleTouchStart(e) {
            touchStartX = e.touches[0].clientX;
        }

        function handleTouchEnd(e) {
            touchEndX = e.changedTouches[0].clientX;
            handleSwipe();
        }

        function handleSwipe() {
            const swipeThreshold = 100;
            const swipeDistance = touchEndX - touchStartX;
            
            if (Math.abs(swipeDistance) > swipeThreshold) {
                const currentIndex = pages.indexOf(currentPage);
                
                if (swipeDistance > 0 && currentIndex > 0) {
                    showPage(pages[currentIndex - 1]);
                } else if (swipeDistance < 0 && currentIndex < pages.length - 1) {
                    showPage(pages[currentIndex + 1]);
                }
            }
        }

        function openSearch() {
            document.getElementById('searchOverlay').classList.add('active');
            document.getElementById('searchInput').focus();
            document.body.style.overflow = 'hidden';
        }

        window.closeSearch = function() {
            document.getElementById('searchOverlay').classList.remove('active');
            document.getElementById('searchInput').value = '';
            document.getElementById('searchResults').innerHTML = '';
            document.body.style.overflow = '';
        }

        function performSearch() {
            const query = document.getElementById('searchInput').value.toLowerCase();
            const results = searchData.filter(item => 
                item.title.toLowerCase().includes(query) || 
                item.description.toLowerCase().includes(query)
            );

            const resultsContainer = document.getElementById('searchResults');
            
            if (query.length === 0) {
                resultsContainer.innerHTML = '';
                return;
            }

            if (results.length === 0) {
                resultsContainer.innerHTML = '<div class="search-result">No results found</div>';
                return;
            }

            resultsContainer.innerHTML = results.map(result => 
                `<div class="search-result" onclick="showPage('${result.page}'); closeSearch();">
                    <strong>${result.title}</strong><br>
                    <small>${result.description}</small>
                </div>`
            ).join('');
        }

        // Enhanced Gallery System
        // Carousel navigation functionality
        const carouselStates = {
            'carousel-pinot': { currentIndex: 0, totalImages: 5 },
            'carousel-rose': { currentIndex: 0, totalImages: 5 },
            'carousel-cottage': { currentIndex: 0, totalImages: 5 }
        };

        const miniGalleryStates = {
            'mini-gallery-pinot': { currentIndex: 0, totalImages: 8, visibleImages: 4 }
        };

        window.navigateCarousel = function(carouselId, direction) {
            const carousel = document.getElementById(carouselId);
            const counter = document.getElementById('counter-' + carouselId.split('-')[1]);
            const state = carouselStates[carouselId];

            if (!carousel || !state) return;

            if (direction === 'next') {
                state.currentIndex = (state.currentIndex + 1) % state.totalImages;
            } else if (direction === 'prev') {
                state.currentIndex = state.currentIndex === 0 ? state.totalImages - 1 : state.currentIndex - 1;
            }

            const translateX = -state.currentIndex * 100;
            carousel.style.transform = `translateX(${translateX}%)`;

            if (counter) {
                counter.textContent = `${state.currentIndex + 1} / ${state.totalImages}`;
            }
        }

        function initializeCarousels() {
            // Reset all carousel states and positions
            Object.keys(carouselStates).forEach(carouselId => {
                const carousel = document.getElementById(carouselId);
                const counter = document.getElementById('counter-' + carouselId.split('-')[1]);
                const state = carouselStates[carouselId];

                if (carousel && state) {
                    // Reset to first image
                    state.currentIndex = 0;
                    carousel.style.transform = 'translateX(0%)';

                    if (counter) {
                        counter.textContent = `1 / ${state.totalImages}`;
                    }
                }
            });
        }

        function navigateMiniGallery(galleryId, direction) {
            const gallery = document.getElementById(galleryId);
            const state = miniGalleryStates[galleryId];

            if (!gallery || !state) return;

            if (direction === 'next') {
                // Move forward by 1 image, but don't go past the end
                if (state.currentIndex < state.totalImages - state.visibleImages) {
                    state.currentIndex++;
                }
            } else if (direction === 'prev') {
                // Move backward by 1 image, but don't go before the start
                if (state.currentIndex > 0) {
                    state.currentIndex--;
                }
            }

            // Calculate the translate value - each image is 25% width + gap
            const translateX = -state.currentIndex * 25;
            gallery.style.transform = `translateX(${translateX}%)`;
        }

        window.openLightbox = function(imageSrc, imageTitle = '') {
            const lightbox = document.getElementById('lightbox');
            const lightboxImage = document.getElementById('lightboxImage');
            const lightboxTitle = document.getElementById('lightboxTitle');

            lightboxImage.src = imageSrc;
            lightbox.classList.add('active');
            document.body.style.overflow = 'hidden';

            // Set title if provided
            if (lightboxTitle && imageTitle) {
                lightboxTitle.textContent = imageTitle;
                lightboxTitle.style.display = 'block';
            } else if (lightboxTitle) {
                lightboxTitle.style.display = 'none';
            }

            currentImageIndex = galleryImages.indexOf(imageSrc);
            if (currentImageIndex === -1) currentImageIndex = 0;

            // Update thumbnail navigation
            updateThumbnailNav();
        }

        window.openCarouselLightbox = function(imageSrc, carouselType, imageTitle = '') {
            const lightbox = document.getElementById('lightbox');
            const lightboxImage = document.getElementById('lightboxImage');
            const lightboxTitle = document.getElementById('lightboxTitle');

            lightboxImage.src = imageSrc;
            lightbox.classList.add('active');
            document.body.style.overflow = 'hidden';

            // Set current carousel context
            currentCarouselContext = carouselType;

            // Set title if provided
            if (lightboxTitle && imageTitle) {
                lightboxTitle.textContent = imageTitle;
                lightboxTitle.style.display = 'block';
            } else if (lightboxTitle) {
                lightboxTitle.style.display = 'none';
            }

            // Find the index in the appropriate carousel
            const carouselImageArray = carouselImages[carouselType] || [];
            currentImageIndex = carouselImageArray.indexOf(imageSrc);
            if (currentImageIndex === -1) currentImageIndex = 0;

            // Update thumbnail navigation with carousel images
            updateCarouselThumbnailNav();

            // Add loading state
            lightboxImage.style.opacity = '0.5';
            lightboxImage.onload = function() {
                this.style.opacity = '1';
            };
        }

        window.closeLightbox = function() {
            document.getElementById('lightbox').classList.remove('active');
            document.body.style.overflow = '';
            // Reset carousel context when lightbox is closed
            currentCarouselContext = null;
        }

        window.nextImage = function() {
            const imageArray = currentCarouselContext ? carouselImages[currentCarouselContext] : galleryImages;
            currentImageIndex = (currentImageIndex + 1) % imageArray.length;
            const lightboxImage = document.getElementById('lightboxImage');
            lightboxImage.style.opacity = '0.5';
            lightboxImage.src = imageArray[currentImageIndex];
            lightboxImage.onload = function() {
                this.style.opacity = '1';
            };

            if (currentCarouselContext) {
                updateCarouselThumbnailNav();
            } else {
                updateThumbnailNav();
            }
        }

        window.prevImage = function() {
            const imageArray = currentCarouselContext ? carouselImages[currentCarouselContext] : galleryImages;
            currentImageIndex = currentImageIndex === 0 ? imageArray.length - 1 : currentImageIndex - 1;
            const lightboxImage = document.getElementById('lightboxImage');
            lightboxImage.style.opacity = '0.5';
            lightboxImage.src = imageArray[currentImageIndex];
            lightboxImage.onload = function() {
                this.style.opacity = '1';
            };

            if (currentCarouselContext) {
                updateCarouselThumbnailNav();
            } else {
                updateThumbnailNav();
            }
        }
        
        function updateThumbnailNav() {
            const thumbnailContainer = document.getElementById('lightboxThumbnails');
            if (!thumbnailContainer) return;

            thumbnailContainer.innerHTML = '';
            galleryImages.forEach((img, index) => {
                const thumb = document.createElement('div');
                thumb.className = `thumbnail ${index === currentImageIndex ? 'active' : ''}`;
                thumb.style.cssText = `
                    width: 60px; height: 40px; margin: 0 4px; cursor: pointer; border-radius: 4px;
                    background-image: url('${img}'); background-size: cover; background-position: center;
                    border: 2px solid ${index === currentImageIndex ? 'var(--brand-teal)' : 'transparent'};
                    transition: all 0.3s ease;
                `;
                thumb.onclick = () => {
                    currentImageIndex = index;
                    document.getElementById('lightboxImage').src = galleryImages[currentImageIndex];
                    updateThumbnailNav();
                };
                thumbnailContainer.appendChild(thumb);
            });
        }

        function updateCarouselThumbnailNav() {
            const thumbnailContainer = document.getElementById('lightboxThumbnails');
            if (!thumbnailContainer || !currentCarouselContext) return;

            const imageArray = carouselImages[currentCarouselContext];
            thumbnailContainer.innerHTML = '';

            imageArray.forEach((img, index) => {
                const thumb = document.createElement('div');
                thumb.className = `thumbnail ${index === currentImageIndex ? 'active' : ''}`;
                thumb.style.cssText = `
                    width: 60px; height: 40px; margin: 0 4px; cursor: pointer; border-radius: 4px;
                    background-image: url('${img}'); background-size: cover; background-position: center;
                    border: 2px solid ${index === currentImageIndex ? 'var(--brand-teal)' : 'transparent'};
                    transition: all 0.3s ease;
                `;
                thumb.onclick = () => {
                    currentImageIndex = index;
                    document.getElementById('lightboxImage').src = imageArray[currentImageIndex];
                    updateCarouselThumbnailNav();
                };
                thumbnailContainer.appendChild(thumb);
            });
        }

        // Virtual Tour Functionality (placeholder)
        function startVirtualTour(accommodation) {
            alert(`Virtual tour feature coming soon! For now, browse through our ${accommodation} photo gallery above or contact us for a video tour.`);
        }

        function showSocialProof() {
            const socialProof = document.getElementById('socialProof');
            const message = socialProofMessages[socialProofIndex];
            
            document.getElementById('socialProofText').textContent = `${message.name} ${message.action}!`;
            document.getElementById('socialProofTime').textContent = message.time;
            
            socialProof.classList.add('show');
            
            setTimeout(() => {
                socialProof.classList.remove('show');
            }, 4000);
            
            socialProofIndex = (socialProofIndex + 1) % socialProofMessages.length;
            setTimeout(showSocialProof, Math.random() * 30000 + 45000);
        }

        window.acceptCookies = function() {
            document.getElementById('cookieButtons').style.display = 'none';
            trackEvent('cookies', 'accepted');
        }

        window.declineCookies = function() {
            document.getElementById('cookieButtons').style.display = 'none';
            trackEvent('cookies', 'declined');
        }
        
        // Toggle FAQ dropdown functionality
        window.toggleFAQ = function(element) {
            const answer = element.nextElementSibling;
            const arrow = element.querySelector('.faq-arrow');
            
            if (answer.style.maxHeight && answer.style.maxHeight !== '0px') {
                // Close
                answer.style.maxHeight = '0';
                arrow.style.transform = 'rotate(0deg)';
            } else {
                // Open
                answer.style.maxHeight = answer.scrollHeight + 'px';
                arrow.style.transform = 'rotate(180deg)';
            }
        }

        function toggleFooterFAQ() {
            const faqContent = document.getElementById('footerFaqContent');
            const faqBtnText = document.getElementById('faqBtnText');
            const faqBtnArrow = document.getElementById('faqBtnArrow');
            const faqBtn = document.getElementById('faqToggleBtn');
            
            if (faqContent.classList.contains('footer-faq-expanded')) {
                // Collapse
                faqContent.classList.remove('footer-faq-expanded');
                faqBtnText.textContent = 'Frequently Asked Questions';
                faqBtnArrow.style.transform = 'rotate(0deg)';
                faqBtn.setAttribute('aria-expanded', 'false');
                faqContent.setAttribute('aria-hidden', 'true');
                
                // Add a subtle animation to the button
                faqBtn.style.transform = 'scale(0.98)';
                setTimeout(() => {
                    faqBtn.style.transform = 'scale(1)';
                }, 150);
            } else {
                // Expand
                faqContent.classList.add('footer-faq-expanded');
                faqBtnText.textContent = 'Hide FAQ';
                faqBtnArrow.style.transform = 'rotate(180deg)';
                faqBtn.setAttribute('aria-expanded', 'true');
                faqContent.setAttribute('aria-hidden', 'false');
                
                // Add a subtle animation to the button
                faqBtn.style.transform = 'scale(1.02)';
                setTimeout(() => {
                    faqBtn.style.transform = 'scale(1)';
                }, 150);
                
                // Smooth scroll to FAQ section after expansion
                setTimeout(() => {
                    faqBtn.scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'start' 
                    });
                }, 300);
            }
        }

        function trackEvent(action, category) {
            if (typeof gtag !== 'undefined' && action === 'booking_intent') {
                trackBookingIntent(category);
            }
            // Event tracked
        }

        window.trackPageView = function(page) {
            if (typeof gtag !== 'undefined') {
                gtag('event', 'page_view', {
                    'page_title': page,
                    'page_location': window.location.href
                });
            }
            // Page view tracked
        }

        function updateScrollIndicator() {
            const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
            const scrollTop = window.scrollY;
            const scrollPercentage = (scrollTop / scrollHeight) * 100;
            
            document.getElementById('scrollIndicator').style.width = `${scrollPercentage}%`;
        }

        window.loadMoreReviews = function() {
            alert('Loading more reviews... (This would connect to your review database or API)');
        }

        // Accordion functionality
        function toggleAccordion(id) {
            const content = document.getElementById(id);
            const header = content.previousElementSibling;
            
            // Toggle active class
            content.classList.toggle('active');
            header.classList.toggle('active');
            
            // Close other accordions in the same container
            const container = content.closest('.accordion-container');
            const otherContents = container.querySelectorAll('.accordion-content');
            const otherHeaders = container.querySelectorAll('.accordion-header');
            
            otherContents.forEach(item => {
                if (item !== content && item.classList.contains('active')) {
                    item.classList.remove('active');
                }
            });
            
            otherHeaders.forEach(item => {
                if (item !== header && item.classList.contains('active')) {
                    item.classList.remove('active');
                }
            });
        }

        // Keyboard Navigation
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closeSearch();
                closeLightbox();
                closeBookingModal();
                
                const mobileNav = document.getElementById('mobileNav');
                if (mobileNav.classList.contains('active')) {
                    toggleMobileMenu();
                }
            }
            
            if (document.getElementById('lightbox').classList.contains('active')) {
                if (e.key === 'ArrowLeft') prevImage();
                if (e.key === 'ArrowRight') nextImage();
            }
        });

        // Close overlays when clicking outside
        document.addEventListener('click', function(e) {
            const searchOverlay = document.getElementById('searchOverlay');
            const lightbox = document.getElementById('lightbox');
            const bookingModal = document.getElementById('bookingModal');
            
            if (e.target === searchOverlay) closeSearch();
            if (e.target === lightbox) closeLightbox();
            if (e.target === bookingModal) closeBookingModal();
        });

        // SEO performance monitoring
        window.addEventListener('load', () => {
            if (typeof PerformanceObserver !== 'undefined') {
                new PerformanceObserver((entryList) => {
                    for (const entry of entryList.getEntries()) {
                        if (entry.entryType === 'navigation') {
                            if (typeof gtag !== 'undefined') {
                                gtag('event', 'page_load_time', {
                                    'event_category': 'Performance',
                                    'event_label': 'Navigation',
                                    'value': Math.round(entry.loadEventEnd - entry.loadEventStart)
                                });
                            }
                        }
                    }
                }).observe({entryTypes: ['navigation']});
            }
        });
})();

// --- Script block 13 ---
(function() {
// ===========================================
        // BACKEND API CONNECTION - ADD THIS SECTION
        // ===========================================

        // Local backend URL for development
        const API_BASE_URL = window.location.origin;

        // Test backend connection on page load
        async function testBackendConnection() {
            try {
                const response = await fetch(`${API_BASE_URL}/health`);
                const data = await response.json();
                // Console statement removed for production
                
                // Optional: Show connection status for debugging
                if (window.location.search.includes('debug')) {
                    // Console statement removed for production
                }
                
                return true;
            } catch (error) {
                // Console statement removed for production
                return false;
            }
        }

        // Get CSRF token before making POST requests
        // csrfToken already declared above

        async function getCSRFToken() {
            try {
                const response = await fetch(`${API_BASE_URL}/api/csrf-token`, {
                    credentials: 'include'
                });
                const data = await response.json();
                csrfToken = data.csrfToken;
                return csrfToken;
            } catch (error) {
                // Console statement removed for production
                return null;
            }
        }

        // Secure API call wrapper
        async function secureApiCall(endpoint, options = {}) {
            const url = `${API_BASE_URL}${endpoint}`;
            
            const defaultOptions = {
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                }
            };
            
            // Add CSRF token for POST requests
            if (options.method === 'POST' && csrfToken) {
                defaultOptions.headers['X-CSRF-Token'] = csrfToken;
            }
            
            const finalOptions = {
                ...defaultOptions,
                ...options,
                headers: { ...defaultOptions.headers, ...options.headers }
            };
            
            try {
                const response = await fetch(url, finalOptions);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                return await response.json();
            } catch (error) {
                // Console statement removed for production
                throw error;
            }
        }

        // Load accommodations from backend
        async function loadAccommodations() {
            try {
                const data = await secureApiCall('/api/accommodations');
                const accommodations = data.accommodations;
                
                // Console statement removed for production
                
                // Update accommodation cards with real data
                accommodations.forEach(accommodation => {
                    updateAccommodationCard(accommodation);
                });
                
                return accommodations;
            } catch (error) {
                // Console statement removed for production
                // Continue with static data - no user impact
            }
        }

        function updateAccommodationCard(accommodation) {
            // Find accommodation cards by data attribute
            const cardElement = document.querySelector(`[data-accommodation="${accommodation.id}"]`);
            
            if (cardElement) {
                // Update price
                const priceElement = cardElement.querySelector('.price, .card-price');
                if (priceElement) {
                    priceElement.textContent = `$${accommodation.price}/night`;
                }
                
                // Update description
                const descElement = cardElement.querySelector('.description, .card-text');
                if (descElement) {
                    descElement.textContent = accommodation.description;
                }
                
                // Update max guests
                const guestsElement = cardElement.querySelector('.max-guests, .guests');
                if (guestsElement) {
                    guestsElement.textContent = `Up to ${accommodation.maxGuests} guests`;
                }
            }
        }

        // Enhanced booking function (integrate with your existing booking)
        async function createBookingWithBackend(bookingData) {
            try {
                // Ensure we have a CSRF token
                if (!csrfToken) {
                    await getCSRFToken();
                }
                
                const response = await secureApiCall('/api/create-booking', {
                    method: 'POST',
                    body: JSON.stringify(bookingData)
                });
                
                // Console statement removed for production
                return response;
            } catch (error) {
                // Console statement removed for production
                // Fallback to your existing booking flow
                throw error;
            }
        }

        // Initialize backend connection when page loads
        document.addEventListener('DOMContentLoaded', async function() {
            // Console statement removed for production
            
            // Test backend connection
            const backendConnected = await testBackendConnection();
            
            if (backendConnected) {
                // Get CSRF token
                await getCSRFToken();
                
                // Load dynamic accommodations data
                await loadAccommodations();
                
                // Console statement removed for production
            } else {
                // Console statement removed for production
            }
        });

        // ========================================
        // FLOATING BOOK NOW BUTTON
        // ========================================
        function createFloatingBookButton() {
            const floatingButton = document.createElement('div');
            floatingButton.id = 'floating-book-button';
            floatingButton.innerHTML = `
                <button onclick="openBookingModal()" style="
                    background: linear-gradient(135deg, #753742 0%, #1a3a3a 100%);
                    color: white;
                    border: none;
                    padding: 15px 25px;
                    border-radius: 50px;
                    font-weight: 600;
                    font-size: 1rem;
                    box-shadow: 0 8px 25px rgba(45, 90, 90, 0.3);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    transition: all 0.3s ease;
                    min-width: 160px;
                    justify-content: center;
                " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 12px 35px rgba(45, 90, 90, 0.4)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 8px 25px rgba(45, 90, 90, 0.3)'">
                    <span style="font-size: 1.2rem;">📅</span>
                    Book Now
                </button>
                
                <!-- WhatsApp Quick Contact -->
                <a href="https://wa.me/642136868?text=Hi! I'm interested in booking a stay at Lakeside Retreat. Can you help me with availability and pricing?" target="_blank" style="
                    background: #25D366;
                    color: white;
                    border: none;
                    padding: 12px;
                    border-radius: 50%;
                    font-size: 1.2rem;
                    box-shadow: 0 6px 20px rgba(37, 211, 102, 0.3);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    text-decoration: none;
                    margin-top: 15px;
                    width: 50px;
                    height: 50px;
                    transition: all 0.3s ease;
                " onmouseover="this.style.transform='scale(1.1)'; this.style.boxShadow='0 8px 25px rgba(37, 211, 102, 0.4)'" onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='0 6px 20px rgba(37, 211, 102, 0.3)'" title="Chat with us on WhatsApp">
                    💬
                </a>
            `;
            
            floatingButton.style.cssText = `
                position: fixed;
                bottom: 30px;
                right: 30px;
                z-index: 1000;
                opacity: 0;
                visibility: hidden;
                transform: translateY(20px);
                transition: all 0.3s ease;
                pointer-events: none;
                display: flex;
                flex-direction: column;
                align-items: center;
            `;
            
            document.body.appendChild(floatingButton);
            return floatingButton;
        }

        // Show/hide floating button based on scroll
        function handleFloatingButton() {
            const floatingButton = document.getElementById('floating-book-button');
            const heroSection = document.querySelector('.hero');
            
            if (!floatingButton || !heroSection) return;
            
            const heroBottom = heroSection.offsetTop + heroSection.offsetHeight;
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            
            if (scrollTop > heroBottom + 100) {
                // Show button
                floatingButton.style.opacity = '1';
                floatingButton.style.visibility = 'visible';
                floatingButton.style.transform = 'translateY(0)';
                floatingButton.style.pointerEvents = 'auto';
            } else {
                // Hide button
                floatingButton.style.opacity = '0';
                floatingButton.style.visibility = 'hidden';
                floatingButton.style.transform = 'translateY(20px)';
                floatingButton.style.pointerEvents = 'none';
            }
        }

        // FAQ INLINE ONCLICK - NO EXTERNAL FUNCTION NEEDED

        // Performance Optimization: Lazy Loading Images
        function initLazyLoading() {
            const images = document.querySelectorAll('img[data-src]');
            const imageObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.dataset.src;
                        img.classList.remove('lazy');
                        imageObserver.unobserve(img);
                    }
                });
            });

            images.forEach(img => {
                imageObserver.observe(img);
            });
        }

        // WebP Detection and Image Optimization
        function initWebPSupport() {
            // Check WebP support
            const webpSupport = (function() {
                const canvas = document.createElement('canvas');
                canvas.width = 1;
                canvas.height = 1;
                return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
            })();
            
            // Add class to document for CSS feature detection
            if (webpSupport) {
                document.documentElement.classList.add('webp');
            } else {
                document.documentElement.classList.add('no-webp');
            }
            
            return webpSupport;
        }

        // Performance Monitoring (Basic)
        function initPerformanceMonitoring() {
            // Web Vitals monitoring
            if ('web-vital' in window) {
                // Track Core Web Vitals when available
                return;
            }
            
            // Basic performance tracking
            window.addEventListener('load', () => {
                const perfData = performance.getEntriesByType('navigation')[0];
                const loadTime = perfData.loadEventEnd - perfData.loadEventStart;
                
                // Track load time (for future analytics integration)
                if (loadTime > 3000) {
                    console.info('Page load time:', loadTime + 'ms - Consider optimization');
                }
            });
        }

        // Critical Resource Hints
        function addResourceHints() {
            const head = document.head;
            
            // Preload critical images
            const criticalImages = [
                'images/vineyard.jpeg',
                'images/logormbg.png'
            ];
            
            criticalImages.forEach(src => {
                const link = document.createElement('link');
                link.rel = 'preload';
                link.as = 'image';
                link.href = src;
                head.appendChild(link);
            });
        }

        // Initialize floating button, FAQ system, and FORCE V2 VOUCHER SYSTEM  
        document.addEventListener('DOMContentLoaded', function() {
            console.log('🎁 FORCING V2 VOUCHER SYSTEM ON PAGE LOAD');
            
            // Initialize performance optimizations
            initLazyLoading();
            addResourceHints();
            initWebPSupport();
            initPerformanceMonitoring();
            
            // Initialize back to top button
            initBackToTopButton();
            
            // FAQ dropdowns use inline onclick - no initialization needed
            
            // Force replace old voucher HTML with new V2 system
            setTimeout(() => {
                const oldVoucherOptions = document.querySelectorAll('.voucher-option:not(.voucher-option-v2-new)');
                console.log('Found old voucher elements to replace:', oldVoucherOptions.length);
                
                oldVoucherOptions.forEach(oldOption => {
                    const amount = oldOption.getAttribute('data-amount');
                    if (amount && !amount.includes('-v2')) {
                        oldOption.setAttribute('data-amount', amount + '-v2');
                        oldOption.className = oldOption.className.replace('voucher-option', 'voucher-option-v2-new');
                        
                        // Update all child elements
                        const header = oldOption.querySelector('.voucher-option-header');
                        if (header) header.className = 'voucher-option-header-v2-new';
                        
                        const price = oldOption.querySelector('.voucher-price');
                        if (price) price.className = 'voucher-price-v2-new';
                        
                        // Update onclick handler
                        const newAmount = amount + '-v2';
                        oldOption.setAttribute('onclick', `selectVoucherAmountV2New('${newAmount}')`);
                        console.log('✅ Converted voucher option:', amount, '→', newAmount);
                    }
                });
                
                // Force initialize new system
                if (typeof selectVoucherAmountV2New === 'function') {
                    selectVoucherAmountV2New('flexible-550-v2');
                    console.log('✅ V2 voucher system forcefully initialized');
                } else {
                    console.error('❌ V2 voucher functions not loaded');
                }
            }, 100);
            
            createFloatingBookButton();
            window.addEventListener('scroll', handleFloatingButton);

            // Initialize Parallax Scrolling System
            initializeParallaxScrolling();
        });

        // DUPLICATE FAQ FUNCTION REMOVED - NOW DEFINED ABOVE

        // VOUCHER SYSTEM V2 - NEW FUNCTIONS - FORCE OVERRIDE
        console.log('🎁 NEW VOUCHER SYSTEM V2 LOADING...', new Date());
        let selectedVoucherAmountV2New = 'flexible-550-v2'; // Default selection
        let voucherDataV2New = {
            amount: 'flexible-550-v2',
            recipientName: '',
            recipientEmail: '',
            message: '',
            occasion: '',
            purchaserName: '',
            purchaserEmail: '',
            purchaserPhone: '',
            voucherCode: '',
            customAmount: null
        };
        
        // FORCE OVERRIDE OLD FUNCTIONS
        if (typeof selectVoucherAmount !== 'undefined') {
            console.log('⚠️ Overriding old selectVoucherAmount function');
            window.selectVoucherAmount = selectVoucherAmountV2New;
        }
        if (typeof updateVoucherSummary !== 'undefined') {
            console.log('⚠️ Overriding old updateVoucherSummary function');
            window.updateVoucherSummary = updateVoucherSummaryV2New;
        }
})();

// --- Script block 14 ---
(function() {
// Back to Top Button functionality - COMPLETE DEBUG VERSION
        let backToTopVisible = false;
        
        function initBackToTopButton() {
            console.log('🔝 Starting back-to-top button initialization...');
            
            const backToTopBtn = document.getElementById("backToTopBtn");
            if (!backToTopBtn) {
                console.error('❌ Back to top button element not found!');
                return;
            }
            
            console.log('✅ Back to top button element found');
            
            // Force initial styles - override everything
            backToTopBtn.style.cssText = `
                display: block !important;
                position: fixed !important;
                bottom: 30px !important;
                right: 30px !important;
                z-index: 9999 !important;
                background-color: #753742 !important;
                color: white !important;
                border: none !important;
                border-radius: 50% !important;
                width: 50px !important;
                height: 50px !important;
                font-size: 18px !important;
                cursor: pointer !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2) !important;
                transition: all 0.3s ease !important;
                opacity: 0 !important;
                visibility: hidden !important;
            `;
            
            function handleScroll() {
                const scrollY = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
                
                if (scrollY > 100) {
                    backToTopBtn.style.setProperty('opacity', '1', 'important');
                    backToTopBtn.style.setProperty('visibility', 'visible', 'important');
                    backToTopBtn.style.setProperty('display', 'block', 'important');
                    backToTopVisible = true;
                } else {
                    backToTopBtn.style.setProperty('opacity', '0', 'important');
                    backToTopBtn.style.setProperty('visibility', 'hidden', 'important');
                    backToTopVisible = false;
                }
            }
            
            // Multiple event listeners
            window.addEventListener('scroll', handleScroll, { passive: true });
            document.addEventListener('scroll', handleScroll, { passive: true });
            document.body.addEventListener('scroll', handleScroll, { passive: true });
            
            // Immediate test
            setTimeout(() => {
                console.log('🧪 Testing - forcing button visible for 3 seconds...');
                backToTopBtn.style.setProperty('opacity', '1', 'important');
                backToTopBtn.style.setProperty('visibility', 'visible', 'important');
                backToTopBtn.style.setProperty('display', 'block', 'important');
                
                setTimeout(() => {
                    handleScroll(); // Back to normal
                }, 3000);
            }, 1000);
            
            console.log('🎯 Initialization complete');
        }

        // ===== PARALLAX SCROLLING SYSTEM =====
        function initializeParallaxScrolling() {
            console.log('🌊 Initializing Parallax Scrolling System');

            // Detect if device supports smooth parallax
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            const isLowPerformanceDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;

            // Disable complex parallax on mobile/low-performance devices
            if (isMobile || isLowPerformanceDevice) {
                console.log('📱 Mobile/Low-performance device detected - using simplified parallax');
                return;
            }

            let ticking = false;

            function updateParallax() {
                const scrollY = window.pageYOffset;
                const windowHeight = window.innerHeight;

                // Update hero parallax layers
                const heroSection = document.querySelector('.hero');
                if (heroSection) {
                    const heroRect = heroSection.getBoundingClientRect();
                    const heroCenter = heroRect.top + heroRect.height / 2;
                    const distanceFromCenter = Math.abs(heroCenter - windowHeight / 2);
                    const maxDistance = windowHeight;
                    const parallaxStrength = Math.min(distanceFromCenter / maxDistance, 1);

                    // Apply different transform speeds for layered effect
                    const parallaxLayers = heroSection.querySelectorAll('.parallax-layer');
                    parallaxLayers.forEach((layer, index) => {
                        const speed = 0.5 + (index * 0.3); // Different speeds for each layer
                        const yPos = -(scrollY * speed);
                        layer.style.transform = `translate3d(0, ${yPos}px, 0)`;
                    });
                }

                // Update section transitions
                const sectionTransitions = document.querySelectorAll('.section-transition');
                sectionTransitions.forEach(section => {
                    const rect = section.getBoundingClientRect();
                    const elementTop = rect.top;
                    const elementBottom = rect.bottom;

                    // Only apply parallax if element is in viewport
                    if (elementBottom >= 0 && elementTop <= windowHeight) {
                        const scrollPercent = (windowHeight - elementTop) / (windowHeight + rect.height);
                        const parallaxOffset = scrollPercent * 100;
                        section.style.backgroundPosition = `center ${50 - parallaxOffset * 0.5}%`;
                    }
                });

                ticking = false;
            }

            function requestParallaxUpdate() {
                if (!ticking) {
                    requestAnimationFrame(updateParallax);
                    ticking = true;
                }
            }

            // Optimized scroll listener with passive flag
            window.addEventListener('scroll', requestParallaxUpdate, { passive: true });

            // Initial parallax setup
            updateParallax();

            console.log('✨ Parallax scrolling system initialized');
        }

        // ===== PARALLAX LAYER CREATION HELPER =====
        function createParallaxLayers(container, backgroundImages) {
            if (!container || !backgroundImages) return;

            // Clear existing parallax layers
            const existingLayers = container.querySelectorAll('.parallax-layer');
            existingLayers.forEach(layer => layer.remove());

            // Create new parallax layers
            backgroundImages.forEach((imageSrc, index) => {
                const layer = document.createElement('div');
                layer.className = `parallax-layer parallax-layer-${index === 0 ? 'bg' : index === 1 ? 'mid' : 'front'}`;
                layer.style.backgroundImage = `url('${imageSrc}')`;
                container.appendChild(layer);
            });

            console.log(`🎨 Created ${backgroundImages.length} parallax layers`);
        }

        // ===== PARALLAX TESTING & DEBUGGING =====
        function testParallaxSystem() {
            console.log('🧪 Testing Parallax System...');

            // Test mobile detection
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            console.log('📱 Mobile detected:', isMobile);

            // Test parallax elements
            const heroSections = document.querySelectorAll('.hero.parallax-container');
            console.log('🎯 Hero sections with parallax:', heroSections.length);

            const parallaxLayers = document.querySelectorAll('.parallax-layer');
            console.log('🌊 Total parallax layers:', parallaxLayers.length);

            const sectionTransitions = document.querySelectorAll('.section-transition');
            console.log('🔄 Section transitions:', sectionTransitions.length);

            // Test performance
            const hardwareConcurrency = navigator.hardwareConcurrency || 'unknown';
            console.log('⚡ CPU cores:', hardwareConcurrency);

            return {
                mobile: isMobile,
                heroSections: heroSections.length,
                parallaxLayers: parallaxLayers.length,
                sectionTransitions: sectionTransitions.length,
                cpuCores: hardwareConcurrency
            };
        }

        // Call test function in development
        window.testParallax = testParallaxSystem;

        window.scrollToTop = function() {
            console.log('Scrolling to top...');
            
            // Force scroll to top immediately
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
            window.scrollTo(0, 0);
            
            // Also try smooth scroll as backup
            try {
                window.scrollTo({
                    top: 0,
                    left: 0,
                    behavior: 'smooth'
                });
            } catch (e) {
                console.log('Smooth scroll not supported, using instant scroll');
            }
        }

        // Initialize page navigation when DOM is loaded
        document.addEventListener('DOMContentLoaded', function() {
            // Initialize the home page as active
            showPage('home');
        });
})();

