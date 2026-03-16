class EmailTemplates {
    static emailTemplates = {
        lesson_booked: {
            EN: {
                title: 'Lesson Booked Successfully',
                content: "Hello Dear {{instructor.name}}, You received a Lesson with {{student.name}}. Your lesson time is {{time.date}}. Please don't forget join at the time."
            },
            HE: {
                title: 'השיעור הוזמן בהצלחה',
                content: 'שלום, התלמיד {{student.name}}, השיעור שלך הוזמן בהצלחה עם {{instructor.name}}. השיעור נקבע ל {{time.date}}. בבקשה להכנס בזמן לשיעור.'
            }
        },
        booking_done: {
            EN: {
                title: 'Lesson Booked',
                content: "Hello Dear {{student.name}} 👋🏼, We booked your lesson successfully with teacher {{instructor.name}}.Your lesson time is {{time.date}}.Please don't forget join at the time."
            },
            HE: {
                title: 'השיעור הוזמן בהצלחה',
                content: 'שלום {{student.name}} 👋🏼, השיעור  עם המורה {{instructor.name}} הוזמן בהצלחה,  השיעור נקבע ל {{time.date}}. חשוב וממולץ להכנס לשיעור כמה דקות לפני תחילת השיעור .'
            }
        },
        student_class_cancelled: {
            EN: {
                title: 'Lesson Canceled',
                content: 'Hello,Student {{student.name}} canceled the class of {{class.time}}.Please check your dashboard.'
            },
            HE: {
                title: 'Lesson Canceled',
                content: 'Hello,Student {{student.name}} canceled the class of {{class.time}}.Please check your dashboard.'
            }
        },
        student_class_rescheduled: {
            EN: {
                title: 'Lesson Rescheduled',
                content: 'Hello,Student {{student.name}} rescheduled the class of {{old.time}} to {{new.time}}.Please check your dashboard.'
            },
            HE: {
                title: 'Lesson Rescheduled',
                content: 'Hello,Student {{student.name}} rescheduled the class of {{old.time}} to {{new.time}}.Please check your dashboard.'
            }
        }
    };

    static toData(template, values, useCase) {
        const needMarkup = useCase === 'web' || useCase === 'email';
        const needGoTo = values.link !== undefined;
        let markupTemplate = '';
        let content = template.content;

        if (needMarkup) {
            markupTemplate += `${content}`;
            markupTemplate += needGoTo ? `<a class='text-primary' href='${values.link}'>Show</a></p>` : '';
            template.content = markupTemplate;
        }

        const title = template.title.replace(/{{(.*?)}}/g, (match, p1) => values[p1] || '');
        content = template.content.replace(/{{(.*?)}}/g, (match, p1) => values[p1] || '');

        return {
            title: title,
            content: content
        };
    }

    static getNotification(key, language, useCase = 'email', values = {}) {
        language = language || 'HE';
        if (!EmailTemplates.emailTemplates[key][language]) {
            return null;
        }
        const notificationTemplate = EmailTemplates.emailTemplates[key][language];
        const notification = EmailTemplates.toData(notificationTemplate, values, useCase);
        return notification;
    }
}

module.exports = EmailTemplates;
