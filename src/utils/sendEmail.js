const mailgun = require("mailgun-js");
const config = require("../config/config");

// Function to detect if text contains Hebrew characters
function containsHebrew(text) {
    const hebrewRegex = /[\u0590-\u05FF]/;
    return hebrewRegex.test(text);
}

// Helper function to detect payment links
function isPaymentLink(url) {
    const paymentKeywords = [
        '/payment/',
        'payplus',
        'stripe',
        'paypal',
        'checkout',
        'billing',
        'purchase',
        'pay.link',
        'payments'
    ];
    return paymentKeywords.some(keyword => url.toLowerCase().includes(keyword));
}

// Function to convert plain text to formatted HTML
function formatEmailContent(text) {
    // Split text into lines
    const lines = text.split('\n');
    let formattedLines = [];
    let isHebrew = containsHebrew(text);
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (!line) {
            // Skip empty lines entirely
            continue;
        }
        
        // Check if line contains a payment link
        if (line.includes('http') && isPaymentLink(line)) {
            const buttonText = isHebrew ? '💳 השלם תשלום' : '💳 Complete Payment';
            const enrollText = isHebrew ? '🎓 הירשם עכשיו' : '🎓 Enroll Now';
            const secureText = isHebrew ? '🔒 תשלום מאובטח ובטוח' : '🔒 Secure and Safe Payment';
            const clickText = isHebrew ? 'לחץ כאן להשלמת ההרשמה' : 'Click here to complete your enrollment';
            
            formattedLines.push(`
                <div style="margin: 20px 0; text-align: center;">
                    <div style="
                        background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
                        padding: 20px;
                        border-radius: 15px;
                        border: 1px solid #dee2e6;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.05);
                    ">
                        <div style="
                            font-size: 14px;
                            color: #495057;
                            margin-bottom: 15px;
                            font-weight: 500;
                            direction: ${isHebrew ? 'rtl' : 'ltr'};
                        ">🔗 ${clickText}</div>
                        
                        <a href="${line}" style="
                            display: inline-block;
                            background: linear-gradient(135deg, #00C7C4 0%, #00a8a5 100%);
                            color: white !important;
                            padding: 15px 35px;
                            text-decoration: none;
                            border-radius: 12px;
                            font-weight: bold;
                            font-size: 16px;
                            margin: 8px 0;
                            box-shadow: 0 6px 25px rgba(0, 199, 196, 0.3);
                            transition: all 0.3s ease;
                            border: none;
                            text-align: center;
                            min-width: 200px;
                            font-family: inherit;
                        ">${enrollText}</a>
                        
                        <div style="
                            font-size: 12px;
                            color: #6c757d;
                            margin-top: 10px;
                            direction: ${isHebrew ? 'rtl' : 'ltr'};
                        ">${secureText}</div>
                    </div>
                </div>
            `);
            continue;
        }
        
        // Check if line contains a Zoom link
        if (line.includes('http') && (line.includes('zoom') || line.includes('meet'))) {
            const zoomText = isHebrew ? '🎥 הצטרף לפגישת Zoom' : '🎥 Join Zoom Meeting';
            
            formattedLines.push(`
                <div style="margin: 15px 0; text-align: center;">
                    <a href="${line}" style="
                        display: inline-block;
                        background: linear-gradient(135deg, #00C7C4 0%, #00a8a5 100%);
                        color: white !important;
                        padding: 12px 24px;
                        text-decoration: none;
                        border-radius: 8px;
                        font-weight: bold;
                        font-size: 14px;
                        margin: 5px 0;
                        box-shadow: 0 4px 15px rgba(0, 199, 196, 0.3);
                        transition: all 0.3s ease;
                        font-family: inherit;
                    ">${zoomText}</a>
                </div>
            `);
            continue;
        }
        
        // Check if line contains meeting details (ID, Access code)
        if (line.includes('Meeting ID:') || line.includes('Access code:') || 
            line.includes('מזהה פגישה:') || line.includes('קוד גישה:')) {
            formattedLines.push(`
                <div style="
                    background: linear-gradient(135deg, #f0fffe 0%, #e6fffe 100%);
                    padding: 12px 15px;
                    border-radius: 8px;
                    margin: 8px 0;
                    font-family: 'Courier New', monospace;
                    font-size: 13px;
                    direction: ${isHebrew ? 'rtl' : 'ltr'};
                    text-align: ${isHebrew ? 'right' : 'left'};
                    border-left: 4px solid #00C7C4;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
                    font-weight: 600;
                    color: #495057;
                ">${line}</div>
            `);
            continue;
        }
        
        // Check if line contains package/price information (💰, 💲)
        if (line.includes('💰') || line.includes('💲') || line.includes('Package:') || line.includes('Price:') || 
            line.includes('חבילה:') || line.includes('מחיר:')) {
            formattedLines.push(`
                <div style="
                    background: linear-gradient(135deg, #e8f5e8 0%, #f0f8f0 100%);
                    padding: 12px 18px;
                    border-radius: 10px;
                    margin: 8px 0;
                    border-left: 4px solid #28a745;
                    direction: ${isHebrew ? 'rtl' : 'ltr'};
                    text-align: ${isHebrew ? 'right' : 'left'};
                    font-weight: 500;
                    font-size: 14px;
                    color: #155724;
                    box-shadow: 0 2px 8px rgba(40, 167, 69, 0.1);
                ">${line}</div>
            `);
            continue;
        }
        
        // Check if line contains important info (🔗, ⏰, 📅)
        if (line.includes('🔗') || line.includes('⏰') || line.includes('📅') || 
            line.includes('valid for') || line.includes('תקף למשך')) {
            formattedLines.push(`
                <div style="
                    background: linear-gradient(135deg, #e0f7f7 0%, #b3efef 100%);
                    padding: 12px 15px;
                    border-radius: 8px;
                    margin: 8px 0;
                    border-left: 4px solid #00C7C4;
                    direction: ${isHebrew ? 'rtl' : 'ltr'};
                    text-align: ${isHebrew ? 'right' : 'left'};
                    color: #004c4a;
                    font-weight: 500;
                    box-shadow: 0 2px 8px rgba(0, 199, 196, 0.1);
                ">${line}</div>
            `);
            continue;
        }
        
        // Check if line is a greeting (contains 👋)
        if (line.includes('👋')) {
            formattedLines.push(`
                <div style="
                    font-size: 20px;
                    font-weight: 600;
                    margin: 25px 0 20px 0;
                    direction: ${isHebrew ? 'rtl' : 'ltr'};
                    text-align: ${isHebrew ? 'right' : 'left'};
                    color: #2c3e50;
                    line-height: 1.4;
                ">${line}</div>
            `);
            continue;
        }
        
        // Check if line is a title (first line or contains "Your Personalized")
        if (i === 0 || line.includes('Your Personalized') || line.includes('קישור התשלום') || 
            line.includes('Personalized Payment Link')) {
            formattedLines.push(`
                <div style="
                    font-size: 24px;
                    font-weight: 700;
                    margin: 0 0 25px 0;
                    direction: ${isHebrew ? 'rtl' : 'ltr'};
                    text-align: ${isHebrew ? 'right' : 'left'};
                    color: #2c3e50;
                    line-height: 1.3;
                    padding-bottom: 15px;
                    border-bottom: 2px solid #e9ecef;
                ">${line}</div>
            `);
            continue;
        }
        
        // Check if line is a signature/footer
        if (line.includes('Best regards') || line.includes('בברכה') || 
            line.includes('The Tulkka Team') || line.includes('צוות טולקה') || line.includes('צוות') || 
            line.includes('We look forward') || line.includes('אנו מצפים')) {
            
            // Check if this is the start of signature (Best regards, בברכה, We look forward, אנו מצפים)
            const isSignatureStart = line.includes('Best regards') || line.includes('בברכה') || 
                                   line.includes('We look forward') || line.includes('אנו מצפים');
            
            if (isSignatureStart) {
                // Look ahead to see if next line is team name
                const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
                const isNextLineTeam = nextLine.includes('The Tulkka Team') || nextLine.includes('צוות טולקה') || nextLine.includes('צוות');
                
                if (isNextLineTeam) {
                    // Combine both lines in one tight div with absolutely no spacing
                    formattedLines.push(`
                        <div style="
                            margin-top: 15px;
                            padding-top: 10px;
                            border-top: 1px solid #e0e0e0;
                            color: #666;
                            direction: ${isHebrew ? 'rtl' : 'ltr'};
                            text-align: ${isHebrew ? 'right' : 'left'};
                            font-size: 14px;
                            font-weight: normal;
                            line-height: 1.3;
                        ">
                            <div style="margin: 0; padding: 0; line-height: 1.3;">${line}</div>
                            <div style="margin-top: 3px; padding: 0; line-height: 1.3; font-weight: 500; color: #00C7C4;">${nextLine}</div>
                        </div>
                    `);
                    // Skip the next line since we've already processed it
                    i++;
                } else {
                    formattedLines.push(`
                        <div style="
                            margin-top: 15px;
                            padding-top: 10px;
                            border-top: 1px solid #e0e0e0;
                            color: #666;
                            direction: ${isHebrew ? 'rtl' : 'ltr'};
                            text-align: ${isHebrew ? 'right' : 'left'};
                            font-size: 14px;
                            font-weight: normal;
                        ">${line}</div>
                    `);
                }
            } else if (!lines[i-1] || (!lines[i-1].trim().includes('Best regards') && !lines[i-1].trim().includes('בברכה'))) {
                // Only add if it's not already processed as part of the signature block above
                const teamColor = (line.includes('The Tulkka Team') || line.includes('צוות טולקה') || line.includes('צוות')) ? '#00C7C4' : '#666';
                formattedLines.push(`
                    <div style="
                        margin-top: 15px;
                        padding-top: 10px;
                        border-top: 1px solid #e0e0e0;
                        color: ${teamColor};
                        direction: ${isHebrew ? 'rtl' : 'ltr'};
                        text-align: ${isHebrew ? 'right' : 'left'};
                        font-size: 14px;
                        font-weight: 500;
                    ">${line}</div>
                `);
            }
            continue;
        }
        
        // Regular paragraph with enhanced styling
        if (line) {
            formattedLines.push(`
                <div style="
                    margin: 12px 0;
                    line-height: 1.7;
                    direction: ${isHebrew ? 'rtl' : 'ltr'};
                    text-align: ${isHebrew ? 'right' : 'left'};
                    color: #495057;
                    font-size: 15px;
                ">${line}</div>
            `);
        }
    }
    
    return formattedLines.join('');
}

// Simple and professional HTML email template matching GoDaddy style - CONSISTENT ACROSS ALL DEVICES
function getEmailTemplate(text, logoUrl = "https://tulkka.com/store/1/comp-logo-footer.png") {
    const isHebrew = containsHebrew(text);
    const formattedContent = formatEmailContent(text);
    
    return `
        <!DOCTYPE html>
        <html dir="${isHebrew ? 'rtl' : 'ltr'}" lang="${isHebrew ? 'he' : 'en'}">
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="X-UA-Compatible" content="IE=edge">
            <title>Tulkka - Personalized English Learning</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    line-height: 1.6;
                    margin: 0;
                    padding: 0;
                    background-color: #f5f5f5;
                    direction: ${isHebrew ? 'rtl' : 'ltr'};
                    color: #333;
                }
                .email-wrapper {
                    width: 100%;
                    background-color: #f5f5f5;
                    padding: 35px 20px 40px 20px;
                }
                .email-container {
                    max-width: 750px;
                    margin: 0 auto;
                    background-color: #ffffff;
                    border-radius: 0 0 8px 8px;
                    overflow: hidden;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }
                .external-logo {
                    max-width: 240px;
                    height: auto;
                    border-radius: 4px;
                    background-color: white;
                    padding: 10px;
                    display: block;
                    margin: 0 auto;
                }
                .logo-wrapper {
                    text-align: center; 
                    margin: 0 auto 0 auto; 
                    max-width: 750px;
                    background-color: #00C7C4;
                    padding: 20px 0;
                    border-radius: 8px 8px 0 0;
                }
                .logo-text {
                    margin-top: 10px;
                    font-size: 16px;
                    color: white;
                    font-weight: 500;
                    direction: ${isHebrew ? 'rtl' : 'ltr'};
                    text-align: center;
                    font-family: Arial, sans-serif;
                }
                .content {
                    padding: 25px 40px 30px 40px;
                    background-color: #ffffff;
                    direction: ${isHebrew ? 'rtl' : 'ltr'};
                    text-align: ${isHebrew ? 'right' : 'left'};
                    border-radius: 0;
                }
                .footer {
                    padding: 20px 40px;
                    font-size: 12px;
                    color: #888;
                    background-color: #f9f9f9;
                    border-top: 1px solid #e0e0e0;
                    text-align: center;
                }
                .footer p {
                    margin: 5px 0;
                    line-height: 1.4;
                }
                .footer a {
                    color: #007bff;
                    text-decoration: none;
                }
                .footer a:hover {
                    text-decoration: underline;
                }
                
                /* MINIMAL Mobile adjustments - maintaining desktop appearance */
                @media only screen and (max-width: 800px) {
                    .email-wrapper {
                        padding: 30px 15px 35px 15px;
                    }
                    .email-container {
                        max-width: 95%;
                        border-radius: 0 0 8px 8px;
                    }
                    .logo-wrapper {
                        max-width: 95%;
                        padding: 20px 10px;
                        border-radius: 8px 8px 0 0;
                    }
                    .external-logo {
                        max-width: 220px;
                        padding: 10px;
                    }
                    .logo-text {
                        font-size: 15px;
                    }
                    .content {
                        padding: 25px 30px 30px 30px;
                    }
                    .footer {
                        padding: 20px 30px;
                    }
                }
                
                /* Extra small screens - very minimal changes */
                @media only screen and (max-width: 480px) {
                    .email-wrapper {
                        padding: 25px 10px 30px 10px;
                    }
                    .logo-wrapper {
                        padding: 18px 8px;
                    }
                    .external-logo {
                        max-width: 200px;
                    }
                    .content {
                        padding: 25px 25px 30px 25px;
                    }
                    .footer {
                        padding: 20px 25px;
                    }
                }
            </style>
        </head>
        <body>
            <div class="email-wrapper">
                <!-- Logo outside the white box with background bar -->
                <div class="logo-wrapper">
                    <img src="${logoUrl}" alt="Tulkka Logo" class="external-logo">
                    <div class="logo-text">${isHebrew ? 'פלטפורמה ללמידה אישית באנגלית' : 'Personalized English Learning Platform'}</div>
                </div>
                
                <div class="email-container">
                    <div class="content">
                        ${formattedContent}
                    </div>
                    <div class="footer">
                        <p style="margin: 0 0 8px 0;">${isHebrew ? 'אנא אל תשיב להודעה זו. הודעות שנשלחו לכתובת זו לא ייענו.' : 'Please do not reply to this email. Emails sent to this address will not be answered.'}</p>
                        <p style="margin: 0 0 8px 0;"><strong>Copyright © ${new Date().getFullYear()} Tulkka</strong> Operating Company, LLC. ${isHebrew ? 'כל הזכויות שמורות.' : 'All rights reserved.'}</p>
                        <p style="margin: 0;">${isHebrew ? 'תמיכה:' : 'Support:'} <a href="mailto:info@tulkka.com">info@tulkka.com</a> | <a href="https://tulkka.com/login">tulkka.com</a></p>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;
}

// Enhanced email sending function that supports HTML
// Uses Mailgun HTTP API for email delivery
async function sendEmail(email, subject, text, logoUrl) {
    
    if (process.env.NOTIFICATIONS_ENABLED === 'false') {
        console.log(`[SUPPRESSED] Email to ${email}, subject: ${subject}`);
        return {
            success: true,
            messageId: 'suppressed-' + Date.now(),
            response: 'Email suppressed - NOTIFICATIONS_ENABLED=false',
            suppressed: true
        };
    }

    // Validate Mailgun configuration
    if (!config.mailgun_domain || !config.mailgun_secret) {
        throw new Error('Mailgun configuration is missing. Please set MAILGUN_DOMAIN and MAILGUN_SECRET in your environment variables.');
    }

    try {
        // Initialize Mailgun client
        const mg = mailgun({
            apiKey: config.mailgun_secret,
            domain: config.mailgun_domain,
            host: config.mailgun_endpoint || 'api.mailgun.net'
        });

        const htmlContent = getEmailTemplate(text, logoUrl);
        const fromEmail = config.email_user || `noreply@${config.mailgun_domain}`;

        const data = {
            from: `"Tulkka School" <${fromEmail}>`,
            to: email,
            subject: subject,
            text: text, // Plain text version
            html: htmlContent, // HTML version
        };

        const result = await mg.messages().send(data);
        console.log('Email sent successfully via Mailgun:', result.id);
        return {
            success: true,
            messageId: result.id,
            response: 'Email sent via Mailgun HTTP API'
        };
    } catch (error) {
        console.error('Mailgun email sending failed:', error);
        throw new Error(`Failed to send email via Mailgun: ${error.message}`);
    }
}

module.exports = sendEmail;