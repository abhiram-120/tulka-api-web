class InAppNotificationTemplates {
    static notificationTemplates = {
        // Lesson Management
        lesson_booked: {
            EN: {
                title: 'Lesson Booked Successfully',
                content: "Your lesson with {{instructor.name}} is scheduled for {{time.date}}. Don't forget to join on time!"
            },
            HE: {
                title: 'השיעור הוזמן בהצלחה',
                content: 'השיעור עם {{instructor.name}} נקבע ל-{{time.date}}. אל תשכח להצטרף בזמן!'
            }
        },

        lesson_started: {
            EN: {
                title: 'Lesson Started',
                content: "Your lesson has started! Click to join now."
            },
            HE: {
                title: 'השיעור התחיל',
                content: 'השיעור שלך התחיל! לחץ להצטרפות עכשיו.'
            }
        },

        student_class_cancelled: {
            EN: {
                title: 'Lesson Canceled',
                content: "Student {{student.name}} canceled the class on {{class.time}}."
            },
            HE: {
                title: 'שיעור בוטל',
                content: 'התלמיד {{student.name}} ביטל את השיעור ב-{{class.time}}.'
            }
        },

        student_class_rescheduled: {
            EN: {
                title: 'Lesson Rescheduled',
                content: "Student {{student.name}} moved class from {{old.time}} to {{new.time}}."
            },
            HE: {
                title: 'שיעור נדחה',
                content: 'התלמיד {{student.name}} העביר שיעור מ-{{old.time}} ל-{{new.time}}.'
            }
        },

        regular_class_cancelled: {
            EN: {
                title: 'Regular Class Canceled',
                content: "Student {{student.name}} canceled their regular class on {{class.date}} at {{class.time}}."
            },
            HE: {
                title: 'שיעור קבוע בוטל',
                content: 'התלמיד {{student.name}} ביטל את השיעור הקבוע ב-{{class.date}} בשעה {{class.time}}.'
            }
        },

        // Class Reminders
        regular_class_reminders_24: {
            EN: {
                title: 'Class Tomorrow',
                content: "Your English lesson is tomorrow at {{time.time}}."
            },
            HE: {
                title: 'כיתה מחר',
                content: 'שיעור האנגלית שלך מחר בשעה {{time.time}}.'
            }
        },

        regular_class_reminders_4: {
            EN: {
                title: 'Class in 4 Hours',
                content: "Your lesson starts in 4 hours at {{time.time}}."
            },
            HE: {
                title: 'כיתה בעוד 4 שעות',
                content: 'השיעור שלך מתחיל בעוד 4 שעות בשעה {{time.time}}.'
            }
        },

        regular_class_reminders_1: {
            EN: {
                title: 'Class in 1 Hour',
                content: "Your lesson starts in 1 hour. Get ready!"
            },
            HE: {
                title: 'כיתה בעוד שעה',
                content: 'השיעור שלך מתחיל בעוד שעה. התכונן!'
            }
        },

        regular_class_reminders_30: {
            EN: {
                title: 'Class in 30 Minutes',
                content: "Your lesson starts in 30 minutes. Please join on time!"
            },
            HE: {
                title: 'כיתה בעוד 30 דקות',
                content: 'השיעור מתחיל בעוד 30 דקות. אנא הצטרף בזמן!'
            }
        },

        // Learning Content
        homework_received: {
            EN: {
                title: 'New Homework',
                content: "New homework from {{instructor.name}} is waiting for you."
            },
            HE: {
                title: 'שיעורי בית חדשים',
                content: 'שיעורי בית חדשים מ{{instructor.name}} מחכים לך.'
            }
        },

        quiz_received: {
            EN: {
                title: 'New Quiz',
                content: "You received a new quiz from {{instructor.name}}. Complete it on time."
            },
            HE: {
                title: 'מבחן חדש',
                content: 'קיבלת מבחן חדש מ{{instructor.name}}. השלם בזמן.'
            }
        },

        feedback_received: {
            EN: {
                title: 'New Feedback',
                content: "{{instructor.name}} provided feedback on your lesson."
            },
            HE: {
                title: 'משוב חדש',
                content: '{{instructor.name}} סיפק משוב על השיעור שלך.'
            }
        },

        homework_completed: {
            EN: {
                title: 'Homework Completed',
                content: "{{student.name}} completed their homework."
            },
            HE: {
                title: 'שיעורי בית הושלמו',
                content: '{{student.name}} השליפ את שיעורי הבית.'
            }
        },

        quiz_completed: {
            EN: {
                title: 'Quiz Completed',
                content: "{{student.name}} completed their quiz."
            },
            HE: {
                title: 'מבחן הושלם',
                content: '{{student.name}} השליפ את המבחן.'
            }
        },

        // // Regular Classes
        // regular_class_booked_for_teacher_new: {
        //     EN: {
        //         title: 'Regular Classes Scheduled',
        //         content: "You're now teaching {{student.name}} every {{time.day}} at {{time.date}}."
        //     },
        //     HE: {
        //         title: 'שיעורים קבועים נקבעו',
        //         content: 'אתה מלמד את {{student.name}} כל {{time.day}} בשעה {{time.date}}.'
        //     }
        // },

        regular_class_booked_for_student_new: {
            EN: {
                title: 'Regular Classes Scheduled',
                content: "Your lessons with {{instructor.name}} are every {{time.day}} at {{time.date}}."
            },
            HE: {
                title: 'שיעורים קבועים נקבעו',
                content: 'השיעורים שלך עם {{instructor.name}} כל {{time.day}} בשעה {{time.date}}.'
            }
        },

        // Monthly Renewals
        renew_regular_class_booked_good: {
            EN: {
                title: 'Monthly Classes Booked',
                content: "Your classes for this month have been scheduled successfully."
            },
            HE: {
                title: 'השיעורים החודשיים נקבעו',
                content: 'השיעורים שלך לחודש זה נקבעו בהצלחה.'
            }
        },

        renew_class_teacher_notavilableform_students: {
            EN: {
                title: 'Some Classes Unavailable',
                content: "Some classes couldn't be booked due to teacher unavailability. Check app for alternatives."
            },
            HE: {
                title: 'חלק מהשיעורים לא זמינים',
                content: 'חלק מהשיעורים לא נקבעו עקב אי זמינות המורה. בדוק באפליקציה חלופות.'
            }
        },

        renew_class_overclasses_form_students: {
            EN: {
                title: 'Monthly Quota Reached',
                content: "Some classes couldn't be booked - you've reached your monthly limit."
            },
            HE: {
                title: 'הגעת לגבול החודשי',
                content: 'חלק מהשיעורים לא נקבעו - הגעת למכסה החודשית.'
            }
        },

        regular_class_book_for_teacher: {
            EN: {
                title: 'New Class Booked',
                content: "{{student.name}} booked a class with you on {{time.date}} at {{time.time}}."
            },
            HE: {
                title: 'שיעור חדש הוזמן',
                content: '{{student.name}} הזמין שיעור איתך ב-{{time.date}} בשעה {{time.time}}.'
            }
        },

        // Payment Notifications
        payment_successful: {
            EN: {
                title: 'Payment Successful',
                content: "Your payment for {{package.name}} was processed successfully!"
            },
            HE: {
                title: 'התשלום בוצע בהצלחה',
                content: 'התשלום שלך עבור {{package.name}} בוצע בהצלחה!'
            }
        },

        payment_failed: {
            EN: {
                title: 'Payment Failed',
                content: "There was an issue with your payment. Please try again."
            },
            HE: {
                title: 'התשלום נכשל',
                content: 'הייתה בעיה עם התשלום שלך. אנא נסה שוב.'
            }
        },

        payment_reminder: {
            EN: {
                title: 'Payment Reminder',
                content: "Complete your enrollment for {{package.name}} - expires in {{expiry.days}} days."
            },
            HE: {
                title: 'תזכורת תשלום',
                content: 'השלם את ההרשמה ל{{package.name}} - פג תוקף בעוד {{expiry.days}} ימים.'
            }
        },
    };

    static toData(template, values, useCase) {
        const title = template.title.replace(/{{(.*?)}}/g, (match, p1) => values[p1] || '');
        const content = template.content.replace(/{{(.*?)}}/g, (match, p1) => values[p1] || '');

        return {
            title: title,
            content: content
        };
    }

    static getNotification(key, language, useCase = 'push', values = {}) {
        language = language || 'HE';
        
        if (!InAppNotificationTemplates.notificationTemplates[key] || 
            !InAppNotificationTemplates.notificationTemplates[key][language]) {
            return null;
        }
        
        const notificationTemplate = InAppNotificationTemplates.notificationTemplates[key][language];
        const notification = InAppNotificationTemplates.toData(notificationTemplate, values, useCase);
        
        return notification;
    }
}

module.exports = InAppNotificationTemplates;