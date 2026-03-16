class NotificationTemplates {
    static notificationTemplates = {
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
                content: "Hello Dear {{student.name}} 👋🏼, We booked your lesson successfully with teacher {{instructor.name}}. Your lesson time is {{time.date}}. Please don't forget join at the time."
            },
            HE: {
                title: 'השיעור הוזמן בהצלחה',
                content: 'שלום {{student.name}} 👋🏼, השיעור עם המורה {{instructor.name}} הוזמן בהצלחה, השיעור נקבע ל {{time.date}}. חשוב וממולץ להכנס לשיעור כמה דקות לפני תחילת השיעור.'
            }
        },
        student_class_cancelled: {
            EN: {
                title: 'Lesson Canceled',
                content: 'Hello, Student {{student.name}} canceled the class of {{class.time}}. Please check your dashboard.'
            },
            HE: {
                title: 'שיעור בוטל',
                content: 'שלום, התלמיד {{student.name}} ביטל את השיעור של {{class.time}}. אנא בדוק את לוח המחוונים שלך.'
            }
        },
        student_class_rescheduled: {
            EN: {
                title: 'Lesson Rescheduled',
                content: 'Hello, Student {{student.name}} rescheduled the class of {{old.time}} to {{new.time}}. Please check your dashboard.'
            },
            HE: {
                title: 'שיעור נקבע מחדש',
                content: 'שלום, התלמיד {{student.name}} קבע מחדש את השיעור מ-{{old.time}} ל-{{new.time}}. אנא בדוק את לוח המחוונים שלך.'
            }
        },
        trial_class_booking_for_teacher: {
            EN: {
                title: 'Trial Lesson Scheduled',
                content: "Hi {{instructor.name}} 👋🏼,\nA trial lesson has been scheduled for you with the following details:\n👨‍👩‍👦 Parent's Name: {{student.parentName}},\n👦 Student's Name: {{student.name}},\n🎂 Student's Age: {{student.age}},\n📅 Lesson Date: {{lesson.date}},\n🕒 Lesson Time: {{lesson.time}},\n📝 Description of the Student:\n\n{{student.description}},\n\nPlease be prepared for this important trial lesson. Your feedback and attention are crucial for the student's future learning journey.\n\nFor any questions, please feel free to reach out to your manager directly.\n\nGood luck! 🌟"
            },
            HE: {
                title: 'שיעור ניסיון תוזמן',
                content: "היי {{instructor.name}} 👋🏼,\nנקבע לך שיעור ניסיון עם הפרטים הבאים:\n👨‍👩‍👦 שם ההורה: {{student.parentName}},\n👦 שם התלמיד: {{student.name}},\n🎂 גיל התלמיד: {{student.age}},\n📅 תאריך השיעור: {{lesson.date}},\n🕒 שעת השיעור: {{lesson.time}},\n📝 תיאור התלמיד:\n\n{{student.description}},\n\nאנא היכון לשיעור ניסיון חשוב זה. המשוב ותשומת הלב שלך חיוניים למסע הלמידה העתידי של התלמיד.\n\nלכל שאלה, אל תהסס לפנות ישירות למנהל שלך.\n\nבהצלחה! 🌟"
            }
        },
        trial_class_booking: {
            EN: {
                title: 'Trial class booking',
                content: "Invitation to a trial English lesson - Tulkka\n\nHi {{student.name}} 👋🏻,\nFollowing our conversation about trial English lessons at Tulkka 📚\n\n🎯 An introductory lesson has been scheduled for {{time.date}}\n\nJoin the Zoom meeting\n\n{{link.link}}\n\nMeeting ID: {{meet.id}}\n\nAccess code: {{access.code}}\n\nThank you for choosing to study at Tulkka 💪🏼\nGood luck with your lesson ⭐\n\nBest regards,\nThe Tulkka Team 📚"
            },
            HE: {
                title: 'הזמנת שיעורי ניסיון',
                content: "זימון לשיעור נסיון באנגלית - טולקה\n\nהיי {{student.name}} 👋🏻,\nבהמשך לשיחתנו לגבי שיעורי נסיון באנגלית ב Tulkka 📚\n\n🎯 נקבע שיעור היכרות ב - {{time.date}}\n\nהצטרף לפגישת זום\n\n{{link.link}}\n\nמזהה פגישה: {{meet.id}}\nקוד גישה: {{access.code}}\n\nתודה שבחרתם ללמוד ב- Tulkka 💪🏼\nשיהיה בהצלחה בשיעור ⭐\n\nבברכה,\nצוות Tulkka 📚"
            }
        },
        regular_class_for_teacher: {
            EN: {
                title: 'Regular Class Scheduled',
                content: "New Regular Class\n\nHi {{instructor.name}} 👋🏼,\n\nCongratulations! You are scheduled to teach classes regularly to {{student.name}}.\n\nThe classes will take place every {{time.day}}.\n\nWe appreciate your dedication to teaching at Tulkka 📚"
            },
            HE: {
                title: 'שיעור קבוע תוזמן',
                content: "חוג רגיל חדש\n\nהיי {{instructor.name}} 👋🏼,\n\nמזל טוב! אתה מתוכנן ללמד שיעורים באופן קבוע ל-{{student.name}}.\n\nהשיעורים יתקיימו כל {{time.day}}.\n\nאנו מעריכים את מסירותך ללמד ב-Tulkka 📚"
            }
        },
        regular_class_book_for_student: {
            EN: {
                title: 'Regular Lessons Scheduled',
                content: "Regular Lessons Scheduled\n\nHey {{student.name}} 👋🏼,\n\nGreat news! 🎉 Your regular lessons have been scheduled.\n\nYour lessons will take place on:\n{{time.day}} 📅\n(until you reach your monthly lesson quota)\n\nRemember:\nYou can easily change your lesson times through our app or website! 🌟\nLessons can be rescheduled up to 4 hours before they start\n\nGood luck with your lessons!\nWe're here for any questions.\nTulkka Team 📚"
            },
            HE: {
                title: 'שיעורים קבועים במערכת',
                content: "שיעורים קבועים במערכת\n\nהיי {{student.name}} 👋🏼,\nאיזה כיף! 🎉 נקבעו שיעורים קבועים.\n\nהשיעורים יתקיימו בימי {{time.day}} 📅\n(עד ניצול מכסת השיעורים החודשית).\n\nניתן לשנות את מועדי השיעורים בקלות דרך האפליקציה או אתר האינטרנט שלנו! 🌟\nאת השיעור ניתן לשנות עד 4 שעות לפני תחילת השיעור.\n\nבהצלחה בשיעורים, אנחנו כאן לכל שאלה! 📚"
            }
        },
        regular_class_book_for_teacher: {
            EN: {
                title: 'Lesson Booked',
                content: "Class Just Booked\nHello {{instructor.name}},\n\n📅 A new class has just been booked with you, and it will start in less than 24 hours.\n\nStudent: {{student.name}}\nDate: {{time.date}}\nTime: {{time.time}}\n\nClass Duration: {{time.duration}} minutes\n\nIf you have any questions or concerns, feel free to reach out to your manager."
            },
            HE: {
                title: 'השיעור הוזמן בהצלחה',
                content: "השיעור הרגע הוזמן\n\nשלום {{instructor.name}},\n\n📅 הרגע הוזמן איתך שיעור חדש והוא יתחיל בעוד פחות מ-24 שעות.\n\nתלמיד: {{student.name}}\nתאריך: {{time.date}}\nזמן: {{time.time}}\n\nמשך השיעור: {{time.duration}} דקות\n\nאם יש לך שאלות או חששות, אל תהסס לפנות למנהל שלך."
            }
        },
        trial_class_evaluation: {
            EN: {
                title: 'Trial Class Evaluation',
                content: "Hello {{student.name}} 👋🏼,\n\nAttached is the teacher's assessment from your trial lesson.\nThe document includes your English level according to the international CEFR standard 📊, and provides a detailed score for each of the five main components for English language proficiency.\n\nYour level assessment: {{student.level}}.\n\nBased on the lesson, the teacher recommended the following process:\n{{student.recommendation}}\n\nThe recommendations are for guidance only, and you can choose the path that best suits you ☺️.\nOur learning process is private and personally structured 🎯, with close and orderly monitoring that will ensure continuous progress 📈.\n\nOur representative will contact you soon to assist in choosing the appropriate program, but if you have any questions right now, we are available via WhatsApp for any question.\n\nThank you for choosing Tulkka 💪🏼,\nGood luck in the future! 🌟\n\nRegards,\nThe Tulkka Team 📚"
            },
            HE: {
                title: 'הערכת שיעור ניסיון',
                content: "שלום וברכה {{student.name}} 👋🏼,\n\nמצורפת הערכת המורה מהשיעור הניסיון שנערך.\nהמסמך כולל את רמת האנגלית לפי תקן CEFR הבינלאומי 📊, ומספק ציון מפורט לכל אחד מחמשת המרכיבים העיקריים לשליטה בשפה האנגלית.\n\nהערכת הרמה שלך: {{student.level}}.\n\nבהתבסס על השיעור, הומלץ על ידי המורה על התהליך הבא:\n{{student.recommendation}}\n\nההמלצות נועדו להכוונה בלבד, ואתם יכולים לבחור את המסלול המתאים לכם ביותר ☺️.\nתהליך הלמידה אצלנו הוא פרטני ומובנה אישית 🎯, עם מעקב צמוד ומסודר שיבטיח התקדמות מתמשכת 📈.\n\nנציג שלנו יצור איתך קשר בקרוב כדי לסייע בבחירת התכנית המתאימה, אך אם יש לך שאלות כבר עכשיו, אנחנו זמינים דרך וואטסאפ לכל שאלה\n\nתודה שבחרת ב-Tulkka 💪🏼,\nבהצלחה בהמשך! 🌟\n\nבברכה,\nצוות Tulkka 📚"
            }
        },
        lesson_started: {
            EN: {
                title: 'Lesson Started',
                content: "Class starts now\n\nHi {{student.name}} 👋🏼,\n\nThe lesson has started!\n📌 Link to the lesson:\n\n{{link.link}}\n\n🔑 Meeting ID: {{meeting.id}}\n🔒 Access code: {{access.code}}\n\nGood luck in class 😀"
            },
            HE: {
                title: 'השיעור התחיל',
                content: "שיעור החל עכשיו\n\nהיי {{student.name}} 👋🏼,\n\nהשיעור החל !\n📌 קישור לשיעור:\n\n{{link.link}}\n\n🔑 מזהה פגישה: {{meeting.id}}\n🔒 קוד גישה: {{access.code}}\n\nבהצלחה בשיעור 😀"
            }
        },
        regular_class_started: {
            EN: {
                title: 'Lesson Reminder',
                content: "Class starts now\n\nHi {{instructor.name}} 👋🏼,\n\nThe lesson has started!\n📌 Link to the lesson:\n\n{{link.link}}\n\n🔑 Meeting ID: {{meeting.id}}\n🔒 Access code: {{access.code}}\n\nGood luck in class 😀"
            },
            HE: {
                title: 'תזכורות לשיעורים',
                content: "שיעור החל עכשיו\n\nהיי {{instructor.name}} 👋🏼,\n\nהשיעור החל !\n📌 קישור לשיעור:\n\n{{link.link}}\n\n🔑 מזהה פגישה: {{meeting.id}}\n🔒 קוד גישה: {{access.code}}\n\nבהצלחה בשיעור 😀"
            }
        },
        trial_class_lesson_started: {
            EN: {
                title: 'Lesson Reminder',
                content: "Class starts now\n\nHi {{student.name}} 👋🏼,\n\nThe class has started!\n📌 Class link:\n\n{{link.link}}\n\n🔑 Meeting ID: {{meeting.id}}\n🔒 Access code: {{access.code}}\n\nGood luck with your class 😀"
            },
            HE: {
                title: 'תזכורות לשיעורים',
                content: "שיעור החל עכשיו\n\nהיי {{student.name}} 👋🏼,\n\nהשיעור החל !\n📌 קישור לשיעור:\n\n{{link.link}}\n\n🔑 מזהה פגישה: {{meeting.id}}\n🔒 קוד גישה: {{access.code}}\n\nבהצלחה בשיעור 😀"
            }
        },
        regular_class_reminders_24: {
            EN: {
                title: 'Class Reminder',
                content: "Reminder Tulkka Session Tomorrow\n\nHi {{student.name}} 👋🏼,\n\nThis is a reminder that your English lesson with Tulkka is scheduled for tomorrow at {{time.time}}. 🎓\n\nHere are the connection details for your lesson:\n📌 Lesson link:\n\n{{link.link}}\n🔑 Meeting ID: {{meeting.id}}\n🔒 Passcode: {{access.code}}\n\nSee you in the lesson tomorrow! 😊"
            },
            HE: {
                title: 'תזכורת לכיתה',
                content: "מחר שיעור אנגלית עם Tulkka\n\nהיי {{student.name}} 👋🏼,\nתזכורת ששיעור האנגלית שלך עם Tulkka יתקיים מחר בשעה {{time.time}}. 🎓\n\nהנה פרטי ההתחברות לשיעור:\n\n📌 קישור לשיעור:\n\n{{link.link}}\n\n🔑 מזהה פגישה: {{meeting.id}}\n🔒 קוד גישה: {{access.code}}\n\nנתראה בשיעור מחר ! 😊"
            }
        },
        regular_class_reminders_4: {
            EN: {
                title: 'Class Reminder',
                content: "Reminder Tulkka Session in 4 Hour\n\nHi {{student.name}} 👋🏼,\n\nYour English lesson with Tulkka will take place in 4 hours at {{time.time}}. 🎓\n\nHere's the link to the lesson:\n\n{{link.link}}\n\n🔑 Meeting ID: {{meeting.id}}\n🔒 Passcode: {{access.code}}\n\nSee you in the lesson! 😊"
            },
            HE: {
                title: 'תזכורת לכיתה',
                content: "היי {{student.name}} 👋🏼,\n\nשיעור האנגלית שלך עם Tulkka יתקיים בעוד 4 שעות בשעה {{time.time}}. 🎓\n\nמצורף הקישור לשיעור:\n{{link.link}}\n\n🔑 מזהה פגישה: {{meeting.id}}\n🔒 קוד גישה: {{access.code}}\n\nנתראה בשיעור ! 😊"
            }
        },
        regular_class_reminders_1: {
            EN: {
                title: 'Class Reminder',
                content: "Reminder Tulkka Session in 1 Hour\n\nHi {{student.name}} 👋🏼,\n\nYour English lesson with Tulkka will take place in 1 hour at {{time.time}}. 🎓\n\nHere's the link to the lesson:\n\n{{link.link}}\n\n🔑 Meeting ID: {{meeting.id}}\n🔒 Passcode: {{access.code}}\n\nSee you in the lesson! 😊"
            },
            HE: {
                title: 'תזכורת לכיתה',
                content: "שעת לתחילת השיעור עם Tulkka\n\nהיי {{student.name}} 👋🏼,\n\nהשיעור שלך עם Tulkka יתחיל בעוד שעה! ⏳\nאנחנו ממליצים להתכונן ולהתחבר בזמן.\n\nפרטי ההתחברות לשיעור:\n\n📌 קישור לשיעור:\n\n{{link.link}}\n\n🔑 מזהה פגישה: {{meeting.id}}\n🔒 קוד גישה: {{access.code}}\n\nמחכים לראות אותך בקרוב! 😊"
            }
        },
        trial_class_reminders_24: {
            EN: {
                title: 'Lesson Reminder',
                content: "Tomorrow - English Trial Lesson with Tulkka\n\nHi {{student.name}} 👋🏼,\nWe are excited to announce that the trial lesson with Tulkka is scheduled for tomorrow at {{time.date}}! 🎉\n\nJoin the Zoom meeting\n\n{{link.link}}\n\nMeeting ID: {{meeting.id}}\nAccess code: {{access.code}}\n\nLooking forward to seeing you and wishing you success! 🌟\nThe Tulkka team 📚"
            },
            HE: {
                title: 'תזכורות לשיעורים',
                content: "מחר - שיעור נסיון באנגלית עם Tulkka\n\nהיי {{student.name}} 👋🏼,\nאנחנו מתרגשים להזכיר ששיעור הניסיון עם Tulkka נקבע למחר בשעה {{time.date}} ! 🎉\n\nהצטרף לפגישת זום\n\n{{link.link}}\n\nמזהה פגישה: {{meeting.id}}\nקוד גישה: {{access.code}}\n\nמחכים לראות אותך ומאחלים לך הצלחה! 🌟\nצוות Tulkka 📚"
            }
        },
        trial_class_reminders_4: {
            EN: {
                title: 'Lesson Reminder',
                content: "Tulkka Reminder - Trial Class Starts in 4 Hours\n\nHi {{student.name}} 👋🏼,\n\nJust a quick reminder that today's trial class with Tulkka is at {{time.date}}. 🎓\n\nJoin the Zoom Meeting\n\n{{link.link}}\n\nMeeting ID: {{meeting.id}}\nAccess Code: {{access.code}}\n\nLooking forward to seeing you! 😊"
            },
            HE: {
                title: 'תזכורות לשיעורים',
                content: "תזכורת Tulkkka - עוד 4 שעות יחל שיעור הנסיון\n\n\nהיי {{student.name}} 👋🏼,\n\nרק תזכורת קטנה שהיום מתקיים שיעור הניסיון עם Tulkka בשעה {{time.date}}. 🎓\n\nהצטרף לפגישת זום\n\n{{link.link}}\n\nמזהה פגישה: {{meeting.id}}\nקוד גישה: {{access.code}}\n\nמחכים לך בקוצר רוח! 😊"
            }
        },
        trial_class_reminders_1: {
            EN: {
                title: 'Lesson Reminder',
                content: "One hour until the start of your Tulkka trial lesson\n\nHi {{student.name}} 👋🏼,\n\nJust a quick reminder for your Tulkka trial lesson in an hour⏳!\nAttached is the link.\n\n{{link.link}}\n\nMeeting ID: {{meeting.id}}\nAccess Code: {{access.code}}\n\nLooking forward to seeing you! 😊"
            },
            HE: {
                title: 'תזכורות לשיעורים',
                content: "שעה לתחילת שיעור הנסיון עם טולקה\n\nהיי {{student.name}} 👋🏼,\n\nרק תזכורת קצרה לשיעור הניסיון שלך Tulkka בעוד שעה⏳!\nמצורף הקישור.\n\n{{link.link}}\n\nמזהה פגישה: {{meeting.id}}\nקוד גישה: {{access.code}}\n\nמחכים לראות אותך! 😊"
            }
        },
        transfer_accepted: {
            EN: {
                title: 'Trial Transfer Accepted',
                content: "Trial Transfer Accepted\n\nDear {{student.name}} 👋🏼,\n\nGreat news! Your trial class has been accepted by our sales team member {{sales.name}}. \n\nThey will be contacting you soon to discuss your learning journey and the best package options for your needs.\n\nYour trial class details:\n📅 Date: {{class.date}}\n👨‍🏫 Teacher: {{teacher.name}}\n\nIf you have any questions in the meantime, feel free to reply to this message.\n\nThank you for choosing Tulkka!\nThe Tulkka Team 📚"
            },
            HE: {
                title: 'העברת שיעור ניסיון אושרה',
                content: "העברת שיעור ניסיון אושרה\n\nשלום {{student.name}} 👋🏼,\n\nחדשות טובות! שיעור הניסיון שלך אושר על ידי חבר צוות המכירות שלנו {{sales.name}}. \n\nהם יצרו איתך קשר בקרוב כדי לדון במסע הלמידה שלך ובאפשרויות החבילה הטובות ביותר לצרכים שלך.\n\nפרטי שיעור הניסיון שלך:\n📅 תאריך: {{class.date}}\n👨‍🏫 מורה: {{teacher.name}}\n\nאם יש לך שאלות בינתיים, אל תהסס להשיב להודעה זו.\n\nתודה שבחרת בטולקה!\nצוות טולקה 📚"
            }
        },
        transfer_rejected: {
            EN: {
                title: 'Trial Transfer Update',
                content: "Trial Transfer Update\n\nDear {{student.name}} 👋🏼,\n\nWe wanted to let you know that your trial class is being reassigned to a different sales team member who will better match your specific needs.\n\nYour trial class details:\n📅 Date: {{class.date}}\n👨‍🏫 Teacher: {{teacher.name}}\n\nA new representative will be in touch with you shortly to discuss your learning options.\n\nIf you have any questions in the meantime, feel free to reply to this message.\n\nThank you for your patience and understanding!\nThe Tulkka Team 📚"
            },
            HE: {
                title: 'עדכון העברת שיעור ניסיון',
                content: "עדכון העברת שיעור ניסיון\n\nשלום {{student.name}} 👋🏼,\n\nרצינו להודיע לך ששיעור הניסיון שלך מועבר לחבר צוות מכירות אחר שיתאים טוב יותר לצרכים הספציפיים שלך.\n\nפרטי שיעור הניסיון שלך:\n📅 תאריך: {{class.date}}\n👨‍🏫 מורה: {{teacher.name}}\n\nנציג חדש ייצור איתך קשר בקרוב כדי לדון באפשרויות הלמידה שלך.\n\nאם יש לך שאלות בינתיים, אל תהסס להשיב להודעה זו.\n\nתודה על הסבלנות וההבנה שלך!\nצוות טולקה 📚"
            }
        },
        transfer_created: {
            EN: {
                title: 'Trial Class Follow-Up',
                content: "Trial Class Follow-Up\n\nDear {{student.name}} 👋🏼,\n\nThank you for completing your trial class with us! We hope you enjoyed your experience with {{teacher.name}}.\n\nOur sales representative {{sales.name}} will be contacting you soon to discuss your progress and recommend the best learning path for you.\n\nYour trial class details:\n📅 Date: {{class.date}}\n👨‍🏫 Teacher: {{teacher.name}}\n\nIf you have any questions in the meantime, feel free to reply to this message.\n\nThanks again for choosing Tulkka!\nThe Tulkka Team 📚"
            },
            HE: {
                title: 'מעקב אחר שיעור ניסיון',
                content: "מעקב אחר שיעור ניסיון\n\nשלום {{student.name}} 👋🏼,\n\nתודה שהשלמת את שיעור הניסיון שלך איתנו! אנו מקווים שנהנית מהחוויה שלך עם {{teacher.name}}.\n\nנציג המכירות שלנו {{sales.name}} ייצור איתך קשר בקרוב כדי לדון בהתקדמות שלך ולהמליץ על מסלול הלמידה הטוב ביותר עבורך.\n\nפרטי שיעור הניסיון שלך:\n📅 תאריך: {{class.date}}\n👨‍🏫 מורה: {{teacher.name}}\n\nאם יש לך שאלות בינתיים, אל תהסס להשיב להודעה זו.\n\nתודה שוב שבחרת בטולקה!\nצוות טולקה 📚"
            }
        },
        onetime_payment: {
            EN: {
                title: 'Your Payment Link - Tulkka',
                content: "Hello {{student.name}} 👋🏼,\n\nWe're excited to help you start your learning journey with Tulkka!\n\n💰 Package: {{package.name}}\n💲 Price: {{amount}} {{currency}}\n\n🔗 Complete your payment here:\n{{payment.link}}\n\nThis payment link will be valid for {{expiry.days}} days.\n\nIf you have any questions, feel free to contact {{sales.name}}.\n\nWe look forward to welcoming you to the Tulkka family!\nThe Tulkka Team 📚"
            },
            HE: {
                title: 'קישור התשלום שלך - טולקה',
                content: "היי {{student.name}} 👋🏼,\n\nאני עוזרת את בקשת התשלום עבור החבילה לימודים בטולקה.\n\n💰 חבילה: {{package.name}}\n💲 מחיר: {{amount}} {{currency}}\n\n🔗 להשלמת התשלום:\n{{payment.link}}\n\nיש לשלם זה שוב תוקף לכמה ימים בלבד.\n\nתודה שבחרת ב-Tulkka 💪🏼\nצוות Tulkka 📚"
            }
        },
        payment_link_created: {
            EN: {
                title: 'Your Personalized Payment Link - Tulkka',
                content: "Your Personalized Payment Link\n\nDear {{student.name}} 👋🏼,\n\nWe're excited to help you continue your learning journey with Tulkka! Based on your trial class and needs, we've prepared a personalized package for you.\n\n💰 Package: {{package.name}}\n💲 Price: {{amount}} {{currency}}\n\n🔗 To complete your enrollment, please click the link below:\n{{payment.link}}\n\nThis payment link will be valid for {{expiry.days}} days.\n\nIf you have any questions or need assistance, feel free to contact your sales representative {{sales.name}} or reply to this message.\n\nWe look forward to welcoming you to the Tulkka family!\nThe Tulkka Team 📚"
            },
            HE: {
                title: 'קישור התשלום האישי שלך - טולקה',
                content: "קישור התשלום האישי שלך\n\nשלום {{student.name}} 👋🏼,\n\nאנחנו נרגשים לעזור לך להמשיך את מסע הלמידה שלך עם טולקה! בהתבסס על שיעור הניסיון והצרכים שלך, הכנו עבורך חבילה מותאמת אישית.\n\n💰 חבילה: {{package.name}}\n💲 מחיר: {{amount}} {{currency}}\n\n🔗 להשלמת ההרשמה שלך, אנא לחץ על הקישור למטה:\n{{payment.link}}\n\nקישור התשלום הזה יהיה תקף למשך {{expiry.days}} ימים.\n\nאם יש לך שאלות או צריך עזרה, אל תהסס לפנות לנציג המכירות שלך {{sales.name}} או להשיב להודעה זו.\n\nאנו מצפים לקבל אותך למשפחת טולקה!\nצוות טולקה 📚"
            }
        },
        family_payment_link_created: {
            EN: {
                title: 'Family Payment Link — Tulkka',
                content: "Hello {{parent.name}} 👋🏼,\n\nWe've prepared a payment link for your family's learning package.\n\n👨‍👩‍👧‍👦 Children: {{family.childrenCount}}\n💰 Total Amount: {{family.totalAmount}} {{family.currency}}\n🧾 Payment Type: {{family.paymentType}}\n📝 Description: {{family.description}}\n\n🔗 Complete the payment here:\n{{payment.link}}\n\nThis link is valid for {{expiry.days}} days.\n\nIf you need any help, just reply to this message — we're here for you.\n\nTulkka Team 📚"
            },
            HE: {
                title: 'קישור לתשלום משפחתי — Tulkka',
                content: "היי {{parent.name}} 👋🏼,\n\nהכנו עבורך קישור לתשלום עבור חבילת הלמידה המשפחתית.\n\n👨‍👩‍👧‍👦 מספר ילדים: {{family.childrenCount}}\n💰 סכום כולל: {{family.totalAmount}} {{family.currency}}\n🧾 סוג תשלום: {{family.paymentType}}\n📝 תיאור: {{family.description}}\n\n🔗 לתשלום מאובטח:\n{{payment.link}}\n\nהקישור תקף ל-{{expiry.days}} ימים.\n\nיש שאלות? אנחנו כאן לכל דבר — פשוט תענו להודעה.\n\nצוות Tulkka 📚"
            }
        },
        family_payment: {
            EN: {
                title: 'Family Payment Link',
                content: "Hi {{parent.name}} 👋🏼,\n\nHere is your family payment link:\n{{payment.link}}\n\nChildren: {{family.childrenCount}}\nAmount: {{family.totalAmount}} {{family.currency}}\n\nThank you,\nTulkka Team"
            },
            HE: {
                title: 'קישור לתשלום משפחתי',
                content: "היי {{parent.name}} 👋🏼,\n\nזה הקישור לתשלום המשפחתי שלך:\n{{payment.link}}\n\nמספר ילדים: {{family.childrenCount}}\nסכום לתשלום: {{family.totalAmount}} {{family.currency}}\n\nתודה,\nצוות Tulkka"
            }
        },
        payment_successful: {
            EN: {
                title: 'Payment Successful - Welcome to Tulkka!',
                content: "Payment Successful - Welcome to Tulkka!\n\nDear {{student.name}} 👋🏼,\n\nCongratulations! Your payment has been processed successfully and you are now officially part of the Tulkka learning family! 🎉\n\n💰 Package: {{package.name}}\n💲 Amount Paid: {{amount}} {{currency}}\n📅 Payment Date: {{payment.date}}\n\n🎓 What's Next?\nYour learning journey begins now! Our team will contact you soon to schedule your first lessons and provide you with all the necessary information to get started.\n\n🔑 Access Your Account:\nYou can now log in to your student portal to:\n• View your lesson schedule\n• Access learning materials\n• Track your progress\n\nLogin URL: {{login.url}}\n\nIf you have any questions, our student support team is here to help at {{support.email}}.\n\nWelcome aboard and happy learning!\nThe Tulkka Team 📚"
            },
            HE: {
                title: 'התשלום בוצע בהצלחה - ברוכים הבאים לטולקה!',
                content: "התשלום בוצע בהצלחה - ברוכים הבאים לטולקה!\n\nשלום {{student.name}} 👋🏼,\n\nמזל טוב! התשלום שלך עובד בהצלחה ואתה כעת חלק רשמי ממשפחת הלמידה של טולקה! 🎉\n\n💰 חבילה: {{package.name}}\n💲 סכום ששולם: {{amount}} {{currency}}\n📅 תאריך תשלום: {{payment.date}}\n\n🎓 מה הלאה?\nמסע הלמידה שלך מתחיל עכשיו! הצוות שלנו ייצור איתך קשר בקרוב כדי לתזמן את השיעורים הראשונים שלך ולספק לך את כל המידע הדרוש כדי להתחיל.\n\n🔑 גישה לחשבון שלך:\nכעת תוכל להתחבר לפורטל התלמידים שלך כדי:\n• לצפות בלוח הזמנים של השיעורים שלך\n• לגשת לחומרי למידה\n• לעקוב אחר ההתקדמות שלך\n\nכתובת כניסה: {{login.url}}\n\nאם יש לך שאלות, צוות תמיכת התלמידים שלנו כאן כדי לעזור בכתובת {{support.email}}.\n\nברוכים הבאים והצלחה בלמידה!\nצוות טולקה 📚"
            }
        },
        payment_reminder: {
            EN: {
                title: 'Payment Reminder - Complete Your Enrollment',
                content: "Payment Reminder - Complete Your Enrollment\n\nDear {{student.name}} 👋🏼,\n\nWe hope you enjoyed your trial lesson with us! We noticed that you haven't completed your payment yet, and we wanted to remind you about your personalized learning package.\n\n💰 Package: {{package.name}}\n💲 Price: {{amount}} {{currency}}\n\n🔗 Complete your enrollment here:\n{{payment.link}}\n\nThis offer will expire in {{expiry.days}} days.\n\n✨ Why Choose Tulkka?\n• Personalized learning experience\n• Expert instructors\n• Flexible scheduling\n• Proven results\n\nIf you have any questions or concerns, please don't hesitate to contact your sales representative {{sales.name}}.\n\nWe look forward to continuing your learning journey together!\nThe Tulkka Team 📚"
            },
            HE: {
                title: 'תזכורת תשלום - השלם את ההרשמה שלך',
                content: "תזכורת תשלום - השלם את ההרשמה שלך\n\nשלום {{student.name}} 👋🏼,\n\nאנו מקווים שנהנית משיעור הניסיון שלך איתנו! שמנו לב שעדיין לא השלמת את התשלום שלך, ורצינו להזכיר לך את חבילת הלמידה המותאמת אישית שלך.\n\n💰 חבילה: {{package.name}}\n💲 מחיר: {{amount}} {{currency}}\n\n🔗 השלם את ההרשמה שלך כאן:\n{{payment.link}}\n\nהצעה זו תפוג בעוד {{expiry.days}} ימים.\n\n✨ למה לבחור בטולקה?\n• חוויית למידה מותאמת אישית\n• מדריכים מומחים\n• תזמון גמיש\n• תוצאות מוכחות\n\nאם יש לך שאלות או חששות, אל תהסס לפנות לנציג המכירות שלך {{sales.name}}.\n\nאנו מצפים להמשך מסע הלמידה שלך איתנו!\nצוות טולקה 📚"
            }
        },
        payment_failed: {
            EN: {
                title: 'Payment Issue - Let Us Help You',
                content: "Payment Issue - Let Us Help You\n\nDear {{student.name}} 👋🏼,\n\nWe encountered an issue processing your payment for the Tulkka learning package. Don't worry - this happens sometimes and we're here to help you resolve it quickly!\n\n💰 Package: {{package.name}}\n💲 Amount: {{amount}} {{currency}}\n\n🔗 Please try again using this link:\n{{payment.link}}\n\n💡 Common Solutions:\n• Check that your card details are correct\n• Ensure you have sufficient funds\n• Try a different payment method\n• Contact your bank if the issue persists\n\nIf you continue to experience difficulties, please contact your sales representative {{sales.name}} or our support team at {{support.email}}. We're happy to assist you with alternative payment options.\n\nWe're excited to welcome you to Tulkka!\nThe Tulkka Team 📚"
            },
            HE: {
                title: 'בעיה בתשלום - בואו נעזור לך',
                content: "בעיה בתשלום - בואו נעזור לך\n\nשלום {{student.name}} 👋🏼,\n\nנתקלנו בבעיה בעיבוד התשלום שלך עבור חבילת הלמידה של טולקה. אל תדאג - זה קורה לפעמים ואנחנו כאן לעזור לך לפתור את זה במהירות!\n\n💰 חבילה: {{package.name}}\n💲 סכום: {{amount}} {{currency}}\n\n🔗 אנא נסה שוב באמצעות קישור זה:\n{{payment.link}}\n\n💡 פתרונות נפוצים:\n• בדוק שפרטי הכרטיס שלך נכונים\n• וודא שיש לך מספיק כסף\n• נסה דרך תשלום אחרת\n• צור קשר עם הבנק שלך אם הבעיה נמשכת\n\nאם אתה ממשיך לחוות קשיים, אנא צור קשר עם נציג המכירות שלך {{sales.name}} או צוות התמיכה שלנו בכתובת {{support.email}}. אנחנו שמחים לסייע לך עם אפשרויות תשלום חלופיות.\n\nאנחנו נרגשים לקבל אותך לטולקה!\nצוות טולקה 📚"
            }
        },
        payment_failed_immediate: {
            EN: {
                title: "Payment Failed - Action Required",
                content: "Dear {{student.name}} 👋🏼,\n\nWe were unable to process your recent payment.\n\n💲 Amount Due: {{amount}} {{currency}}\n❗ Failed on: {{failed.date}}\n📅 Grace period ends: {{expiry.date}}\n\nYou have {{days.remaining}} days to update your payment details before your subscription is canceled.\n\n🔗 Pay securely here:\n{{payment.link}}\n\nIf you need help, contact us at {{support.email}}.\n\nThank you,\n{{company.name}} Team"
            },
            HE: {
                title: "תשלום נכשל - נדרש עדכון",
                content: "היי {{student.name}} 👋🏼,\n\nניסיון החיוב האחרון לא עבר בהצלחה.\n\n💲 סכום לתשלום: {{amount}} {{currency}}\n❗ תאריך כשל: {{failed.date}}\n📅 תקופת החסד מסתיימת: {{expiry.date}}\n\nיש לך עוד {{days.remaining}} ימים לעדכן את פרטי התשלום לפני שהמנוי יבוטל.\n\n🔗 לתשלום מאובטח:\n{{payment.link}}\n\nצריך עזרה? אנחנו כאן 👉 {{support.email}}\n\nתודה,\nצוות {{company.name}}"
            }
        },
        payment_failed_reminder: {
            EN: {
                title: "Reminder: Payment Still Pending",
                content: "Hi {{student.name}} 👋🏼,\n\nThis is a friendly reminder that your payment is still pending.\n\n💲 Amount Due: {{amount}} {{currency}}\n📅 Grace period ends: {{expiry.date}}\n⏳ Days remaining: {{days.remaining}}\n\nPlease complete your payment to avoid interruption to your lessons.\n\n🔗 Complete payment:\n{{payment.link}}\n\nNeed help? We're here: {{support.email}}.\n\n{{company.name}} Team"
            },
            HE: {
                title: "תזכורת: התשלום עדיין לא בוצע",
                content: "שלום {{student.name}} 👋🏼,\n\nרק להזכיר שהתשלום שלך עדיין ממתין.\n\n💲 סכום לתשלום: {{amount}} {{currency}}\n📅 תקופת החסד מסתיימת: {{expiry.date}}\n⏳ ימים שנותרו: {{days.remaining}}\n\nאנא השלם את התשלום כדי שהשיעורים שלך לא ייפגעו.\n\n🔗 להשלמת תשלום:\n{{payment.link}}\n\nיש שאלות? אנחנו זמינים 👉 {{support.email}}\n\nצוות {{company.name}}"
            }
        },
        subscription_canceled_unpaid: {
            EN: {
                title: "Subscription Canceled — Unpaid Balance",
                content: "Hello {{student.name}},\n\nWe're sorry to inform you that your {{subscription.type}} has been canceled due to unpaid balance.\n\n💲 Outstanding Amount: {{amount}} {{currency}}\n❗ Payment failed on: {{failed.date}}\n🗓 Cancellation date: {{canceled.date}}\n\n{{reactivation.info}}\n\nFor assistance, please contact our support team at {{support.email}}.\n\nRegards,\n{{company.name}} Team"
            },
            HE: {
                title: "המנוי בוטל – יתרה לא שולמה",
                content: "שלום {{student.name}},\n\nהמנוי שלך ל-{{subscription.type}} בוטל עקב חוב שלא שולם.\n\n💲 יתרה פתוחה: {{amount}} {{currency}}\n❗ ניסיון החיוב נכשל בתאריך: {{failed.date}}\n🗓 תאריך ביטול: {{canceled.date}}\n\n{{reactivation.info}}\n\nלכל שאלה או סיוע אפשר לפנות 👉 {{support.email}}\n\nבברכה,\nצוות {{company.name}}"
            }
        },
        admin_welcome: {
            EN: {
                title: 'Welcome to Tulkka as Administrator',
                content: "Hello {{user_name}} 👋🏼,\n\nWelcome to Tulkka! Your administrator account has been successfully created.\n\nAs an administrator, you have access to manage the platform, users, and various settings. You play a crucial role in ensuring the smooth operation of our learning platform.\n\n🔑 Your login email: {{email}}\n🔗 Login URL: {{login_url}}\n\nPlease save your credentials in a secure place. If you have any questions or need assistance, feel free to contact our support team at {{support_email}}.\n\nBest regards,\nThe {{platform_name}} Team 📚"
            },
            HE: {
                title: 'ברוך הבא לטולקה כמנהל מערכת',
                content: "שלום {{user_name}} 👋🏼,\n\nברוך הבא לטולקה! חשבון המנהל שלך נוצר בהצלחה.\n\nכמנהל מערכת, יש לך גישה לניהול הפלטפורמה, משתמשים והגדרות שונות. יש לך תפקיד מכריע בהבטחת הפעילות החלקה של פלטפורמת הלמידה שלנו.\n\n🔑 אימייל הכניסה שלך: {{email}}\n🔗 כתובת כניסה: {{login_url}}\n\nאנא שמור את פרטי הכניסה שלך במקום בטוח. אם יש לך שאלות או צורך בעזרה, אל תהסס לפנות לצוות התמיכה שלנו בכתובת {{support_email}}.\n\nבברכה,\nצוות {{platform_name}} 📚"
            }
        },
        support_agent_welcome: {
            EN: {
                title: 'Welcome to Tulkka as Support Agent',
                content: "Hello {{user_name}} 👋🏼,\n\nWelcome to Tulkka! Your Support Aggent account has been successfully created.\n\nAs a Support Aggent, you have full access to all platform features and administrative capabilities. You have the highest level of permissions to manage and oversee all aspects of the platform.\n\n🔑 Your login email: {{email}}\n🔗 Login URL: {{login_url}}\n\nPlease keep your login information secure. If you need any assistance, our technical team is available at {{support_email}}.\n\nBest regards,\nThe {{platform_name}} Team 📚"
            },
            HE: {
                title: 'ברוך הבא לטולקה כמנהל מערכת ראשי',
                content: "שלום {{user_name}} 👋🏼,\n\nברוך הבא לטולקה! חשבון מנהל המערכת הראשי שלך נוצר בהצלחה.\n\nכמנהל מערכת ראשי, יש לך גישה מלאה לכל תכונות הפלטפורמה ויכולות ניהול. יש לך את הרמה הגבוהה ביותר של הרשאות לניהול ופיקוח על כל היבטי הפלטפורמה.\n\n🔑 אימייל הכניסה שלך: {{email}}\n🔗 כתובת כניסה: {{login_url}}\n\nאנא שמור על פרטי הכניסה שלך במקום בטוח. אם אתה זקוק לעזרה כלשהי, צוות הטכני שלנו זמין בכתובת {{support_email}}.\n\nבברכה,\nצוות {{platform_name}} 📚"
            }
        },
        instructor_welcome: {
            EN: {
                title: 'Welcome to Tulkka as Instructor',
                content: "Hello {{user_name}} 👋🏼,\n\nWelcome to the Tulkka teaching team! Your instructor account has been successfully created.\n\nAs an instructor, you'll be able to manage your classes, interact with students, and access teaching materials. Your expertise will help students achieve their learning goals.\n\n🔑 Your login email: {{email}}\n🔗 Login URL: {{login_url}}\n\nWe recommend logging in to familiarize yourself with the platform before your first class. If you have any questions, our teacher support team is here to help at {{support_email}}.\n\nBest regards,\nThe {{platform_name}} Team 📚"
            },
            HE: {
                title: 'ברוך הבא לטולקה כמדריך',
                content: "שלום {{user_name}} 👋🏼,\n\nברוך הבא לצוות ההוראה של טולקה! חשבון המדריך שלך נוצר בהצלחה.\n\nכמדריך, תוכל לנהל את השיעורים שלך, לתקשר עם תלמידים ולגשת לחומרי הוראה. המומחיות שלך תעזור לתלמידים להשיג את יעדי הלמידה שלהם.\n\n🔑 אימייל הכניסה שלך: {{email}}\n🔗 כתובת כניסה: {{login_url}}\n\nאנו ממליצים להתחבר כדי להכיר את הפלטפורמה לפני השיעור הראשון שלך. אם יש לך שאלות, צוות התמיכה למורים שלנו זמין לעזור בכתובת {{support_email}}.\n\nבברכה,\nצוות {{platform_name}} 📚"
            }
        },
        author_welcome: {
            EN: {
                title: 'Welcome to Tulkka as Content Author',
                content: "Hello {{user_name}} 👋🏼,\n\nWelcome to Tulkka! Your content author account has been successfully created.\n\nAs a content author, you have the important role of creating and maintaining educational materials. Your contributions will directly impact the quality of learning experiences for our students.\n\n🔑 Your login email: {{email}}\n🔗 Login URL: {{login_url}}\n\nThe content creation tools are available in your dashboard. If you need any assistance or have questions about the content guidelines, please contact us at {{support_email}}.\n\nBest regards,\nThe {{platform_name}} Team 📚"
            },
            HE: {
                title: 'ברוך הבא לטולקה כמחבר תוכן',
                content: "שלום {{user_name}} 👋🏼,\n\nברוך הבא לטולקה! חשבון מחבר התוכן שלך נוצר בהצלחה.\n\nכמחבר תוכן, יש לך תפקיד חשוב ביצירה ותחזוקה של חומרי לימוד. התרומות שלך ישפיעו ישירות על איכות חוויות הלמידה עבור התלמידים שלנו.\n\n🔑 אימייל הכניסה שלך: {{email}}\n🔗 כתובת כניסה: {{login_url}}\n\nכלי יצירת התוכן זמינים בלוח המחוונים שלך. אם אתה זקוק לעזרה או יש לך שאלות לגבי הנחיות התוכן, אנא צור קשר בכתובת {{support_email}}.\n\nבברכה,\nצוות {{platform_name}} 📚"
            }
        },
        organization_welcome: {
            EN: {
                title: 'Welcome to Tulkka as Organization Manager',
                content: "Hello {{user_name}} 👋🏼,\n\nWelcome to Tulkka! Your organization manager account has been successfully created.\n\nAs an organization manager, you can oversee all the learning activities for your organization, manage user enrollments, and access performance reports. Your role is crucial in ensuring successful implementation of learning programs.\n\n🔑 Your login email: {{email}}\n🔗 Login URL: {{login_url}}\n\nWe recommend exploring the organization dashboard to familiarize yourself with all available features. If you have any questions, our organization support team is available at {{support_email}}.\n\nBest regards,\nThe {{platform_name}} Team 📚"
            },
            HE: {
                title: 'ברוך הבא לטולקה כמנהל ארגון',
                content: "שלום {{user_name}} 👋🏼,\n\nברוך הבא לטולקה! חשבון מנהל הארגון שלך נוצר בהצלחה.\n\nכמנהל ארגון, אתה יכול לפקח על כל פעילויות הלמידה עבור הארגון שלך, לנהל הרשמות משתמשים ולגשת לדוחות ביצועים. התפקיד שלך הוא קריטי בהבטחת יישום מוצלח של תכניות למידה.\n\n🔑 אימייל הכניסה שלך: {{email}}\n🔗 כתובת כניסה: {{login_url}}\n\nאנו ממליצים לחקור את לוח המחוונים של הארגון כדי להכיר את כל התכונות הזמינות. אם יש לך שאלות, צוות תמיכת הארגון שלנו זמין בכתובת {{support_email}}.\n\nבברכה,\nצוות {{platform_name}} 📚"
            }
        },
        sales_agent_welcome: {
            EN: {
                title: 'Welcome to Tulkka as Sales Agent',
                content: "Hello {{user_name}} 👋🏼,\n\nWelcome to the Tulkka sales team! Your sales agent account has been successfully created.\n\nAs a sales agent, you have access to our customer management system, sales tools, and resources to help you succeed in your role. You'll be able to track leads, manage customer interactions, and close deals efficiently.\n\n🔑 Your login email: {{email}}\n🔗 Login URL: {{login_url}}\n\nWe recommend exploring the sales dashboard to familiarize yourself with the tools available. If you have any questions or need support, please contact your sales manager or email us at {{support_email}}.\n\nBest regards,\nThe {{platform_name}} Team 📚"
            },
            HE: {
                title: 'ברוך הבא לטולקה כסוכן מכירות',
                content: "שלום {{user_name}} 👋🏼,\n\nברוך הבא לצוות המכירות של טולקה! חשבון סוכן המכירות שלך נוצר בהצלחה.\n\nכסוכן מכירות, יש לך גישה למערכת ניהול הלקוחות שלנו, כלי מכירות ומשאבים שיעזרו לך להצליח בתפקידך. תוכל לעקוב אחר לידים, לנהל אינטראקציות עם לקוחות ולסגור עסקאות ביעילות.\n\n🔑 אימייל הכניסה שלך: {{email}}\n🔗 כתובת כניסה: {{login_url}}\n\nאנו ממליצים לחקור את לוח המחוונים של המכירות כדי להכיר את הכלים הזמינים. אם יש לך שאלות או צורך בתמיכה, אנא פנה למנהל המכירות שלך או שלח לנו דוא\"ל לכתובת {{support_email}}.\n\nבברכה,\nצוות {{platform_name}} 📚"
            }
        },
        sales_appointment_welcome: {
            EN: {
                title: 'Welcome to Tulkka as Appointment Setter',
                content: "Hello {{user_name}} 👋🏼,\n\nWelcome to the Tulkka team! Your appointment setter account has been successfully created.\n\nAs an appointment setter, you play a vital role in connecting potential students with our sales team. You have access to scheduling tools, lead management, and resources to help you book quality appointments.\n\n🔑 Your login email: {{email}}\n🔗 Login URL: {{login_url}}\n\nTake some time to explore the appointment dashboard and familiarize yourself with the tools available. If you have any questions, please reach out to your team leader or contact us at {{support_email}}.\n\nBest regards,\nThe {{platform_name}} Team 📚"
            },
            HE: {
                title: 'ברוך הבא לטולקה כקובע פגישות',
                content: "שלום {{user_name}} 👋🏼,\n\nברוך הבא לצוות טולקה! חשבון קובע הפגישות שלך נוצר בהצלחה.\n\nכקובע פגישות, יש לך תפקיד חיוני בחיבור תלמידים פוטנציאליים עם צוות המכירות שלנו. יש לך גישה לכלי תזמון, ניהול לידים ומשאבים שיעזרו לך לקבוע פגישות איכותיות.\n\n🔑 אימייל הכניסה שלך: {{email}}\n🔗 כתובת כניסה: {{login_url}}\n\nקח זמן לחקור את לוח המחוונים של הפגישות ולהכיר את הכלים הזמינים. אם יש לך שאלות, אנא פנה למנהל הצוות שלך או צור קשר בכתובת {{support_email}}.\n\nבברכה,\nצוות {{platform_name}} 📚"
            }
        },
        student_welcome: {
            EN: {
                title: 'Welcome to Tulkka Learning Platform - Your Login Credentials',
                content: "Hello {{user_name}} 👋🏼,\n\nWelcome to Tulkka! Your student account has been successfully created.\n\nYou're now part of our learning community where you can access courses, interact with instructors, and track your learning progress. We're excited to have you on board and look forward to supporting your educational journey.\n\n🔑 Your login credentials:\n📧 Email: {{email}}\n🔒 Password: {{password}}\n🔗 Login URL: {{login_url}}\n\n⚠️ Important: For your security, we recommend changing your password after your first login.\n\nWe recommend logging in and completing your profile to personalize your learning experience. If you need any assistance, our student support team is available at {{support_email}}.\n\nBest regards,\nThe {{platform_name}} Team 📚"
            },
            HE: {
                title: 'ברוך הבא לפלטפורמת הלמידה של טולקה - פרטי הכניסה שלך',
                content: "שלום {{user_name}} 👋🏼,\n\nברוך הבא לטולקה! חשבון התלמיד שלך נוצר בהצלחה.\n\nאתה כעת חלק מקהילת הלמידה שלנו בה תוכל לגשת לקורסים, לתקשר עם מדריכים ולעקוב אחר התקדמות הלמידה שלך. אנחנו שמחים לקבל אותך ומצפים לתמוך במסע החינוכי שלך.\n\n🔑 פרטי הכניסה שלך:\n📧 אימייל: {{email}}\n🔒 סיסמה: {{password}}\n🔗 כתובת כניסה: {{login_url}}\n\n⚠️ חשוב: למען הביטחון שלך, אנו ממליצים לשנות את הסיסמה שלך לאחר הכניסה הראשונה.\n\nאנו ממליצים להתחבר ולהשלים את הפרופיל שלך כדי להתאים אישית את חווית הלמידה שלך. אם אתה זקוק לעזרה כלשהי, צוות תמיכת התלמידים שלנו זמין בכתובת {{support_email}}.\n\nבברכה,\nצוות {{platform_name}} 📚"
            }
        },
        general_welcome: {
            EN: {
                title: 'Welcome to Tulkka',
                content: "Hello {{user_name}} 👋🏼,\n\nWelcome to Tulkka! Your account has been successfully created.\n\nWe're excited to have you join our platform. You now have access to your personalized dashboard where you can explore our features and services.\n\n🔑 Your login email: {{email}}\n🔗 Login URL: {{login_url}}\n\nIf you have any questions or need assistance, please don't hesitate to contact us at {{support_email}}.\n\nBest regards,\nThe {{platform_name}} Team 📚"
            },
            HE: {
                title: 'ברוך הבא לטולקה',
                content: "שלום {{user_name}} 👋🏼,\n\nברוך הבא לטולקה! החשבון שלך נוצר בהצלחה.\n\nאנחנו שמחים שהצטרפת לפלטפורמה שלנו. כעת יש לך גישה ללוח המחוונים המותאם אישית שלך בו תוכל לחקור את התכונות והשירותים שלנו.\n\n🔑 אימייל הכניסה שלך: {{email}}\n🔗 כתובת כניסה: {{login_url}}\n\nאם יש לך שאלות או צורך בעזרה, אל תהסס לפנות אלינו בכתובת {{support_email}}.\n\nבברכה,\nצוות {{platform_name}} 📚"
            }
        },
        trial_class_student_evaluation: {
            EN: {
                title: 'Trial Class Evaluation',
                content: "Hello {{student.name}} 👋🏼,\n\nThank you for participating in your trial English lesson with Tulkka! 😊\nWe're excited to share your assessment.\n\nAttached is the detailed evaluation report from your trial lesson.\nThe teacher has evaluated your English level according to the international CEFR standard 📊, and provided a detailed score for each of the five main components of English proficiency.\n\n📄 Download your evaluation report: {{pdf}}\n\nYour assessed level: {{student.level}}.\n\nBased on the lesson, the teacher recommended the following learning path:\n{{student.recommendation}}\n\nJoining us at Tulkka means choosing:\n\n🏠 Private lessons in pleasant environments\n📝 Personal learning plan tailored to you\n🔍 Continuous follow-up on your progress\n📈 Proven results in English proficiency improvement\n📚 Lessons in English\n\nOur representative will contact you soon to help choose the appropriate program.\n\nDo you have any additional questions to help you decide about the lessons?\n\nRegards,\nTulkka Team 📚"
            },
            HE: {
                title: 'הערכת שיעור ניסיון',
                content: "היי {{student.name}} 👋🏼,\n\nתודה שהשתתפת בשיעור הניסיון באנגלית עם Tulkka! 😊\nאנחנו מתרגשים לשתף אתך את ההערכה.\n\nמצורף דוח ההערכה המפורט משיעור הניסיון שלך.\nהמורה העריך את רמת האנגלית שלך לפי תקן CEFR הבינלאומי 📊, ונתן ציון מפורט לכל אחד מחמשת המרכיבים העיקריים של שליטה באנגלית.\n\n📄 הורד את דוח ההערכה שלך: {{pdf}}\n\nהרמה המוערכת: {{student.level}}.\n\nבהתבסס על השיעור, המורה המליץ על התהליך הבא:\n{{student.recommendation}}\n\nלהצטרף אלינו ב-Tulkka פירושו לבחור ב:\n\n🏠 שיעורים פרטיים בסביבות נעימות\n📝 תוכנית לימודית מותאמת אישית\n🔍 מעקב רציף אחר ההתקדמות שלך\n📈 תוצאות מוכחות בשיפור שליטה באנגלית\n📚 שיעורים באנגלית\n\nנציג שלנו יצור איתך קשר בקרוב לסייע בבחירת התכנית המתאימה.\n\nיש לך שאלות נוספות לעזור לך להחליט על השיעורים?\n\nבברכה,\nצוות Tulkka 📚"
            }
        },
        renew_regular_class_booked_good: {
            EN: {
                title: 'Your Monthly Classes Are Booked! 📅',
                content: "Hi {{student.name}} 👋\n\nWe’re happy to continue your learning journey this month with Tulkka! 📚\nYour classes have been successfully booked for the following days:\n\n{{message}}\n\nImportant reminders 💡\n📅 You can check your full schedule on the app/website\n⏰ Cancellations are allowed up to 4 hours before class\n\nIf you have any questions or need help, we’re here for you 🤗\n\nTulkka Team 📚"
            },
            HE: {
                title: 'השיעורים החודשיים שלך נקבעו 📅',
                content: "{{student.name}} 👋 היי\n\nשמחים ללוות אותך בחודש נוסף של למידה מגניבה ב-Tulkka! 📚\nהשיעורים שלך נקבעו בהצלחה לימים הבאים:\n\n{{message}}\n\nתזכורות חשובות 💡\n📅 ניתן לצפות בלוח השיעורים המלא שלך באפליקציה/אתר\n⏰ ניתן לבטל שיעור עד 4 שעות לפני תחילתו\n\nאם יש לך שאלות או צורך בעזרה כלשהי, אנחנו כאן 🤗\n\nצוות Tulkka 📚"
            }
        },
        renew_class_teacher_notavilableform_students: {
            EN: {
                title: 'Some Classes Could Not Be Booked',
                content: "Hi {{student.name}} 👋\n\nWe’re happy to continue your learning journey this month with Tulkka! 📚\nYour classes were booked for these days:\n\n{{time.day}}\n\nImportant note 💡\nClasses will not take place on the following dates:\n{{message}}\n\nYour teacher is unavailable on those dates.\nWe apologize for any inconvenience 🙏\n\nOptions for you:\n1️⃣ You can match with another teacher at the same time via the app\n2️⃣ Choose alternative times with another teacher via the app\n\nWe recommend checking your updated schedule in the app.\nWe’re happy to help with any questions 🤗\n\nTulkka Team 📚"
            },
            HE: {
                title: 'חלק מהשיעורים לא נקבעו',
                content: "{{student.name}} 👋 היי\n\nשמחים ללוות אותך בחודש נוסף של למידה מגניבה ב-Tulkka! 📚\nהשיעורים שלך נקבעו בימים:\n\n{{time.day}}\n\nחשוב לציין 💡\nבתאריכים הבאים לא יתקיים שיעור:\n{{message}}\n\nהמורה שלך לא תהיה זמינה בתאריכים אלו\nאנו מתנצלים על אי הנוחות 🙏\n\nהאפשרויות עבורך:\n1️⃣ ניתן לתאם מורה אחר עם אותו לו\"ז באפליקציה\n2️⃣ ניתן לבחור זמני שיעור חלופיים עם מורה אחר באפליקציה\n\nמומלץ לבדוק את לוח השיעורים המעודכן שלך באפליקציה.\nנשמח לעזור בכל שאלה 🤗\n\nצוות Tulkka 📚"
            }
        },
        renew_class_overclasses_form_students: {
            EN: {
                title: 'Too Many Classes This Month 😅',
                content: "Hi {{student.name}} 👋\n\nWe’re happy to continue your learning journey this month with Tulkka! 📚\nYour classes were booked on:\n\n{{time.day}}\n\nImportant note 💡\nSome classes could not be scheduled due to overbooking:\n{{message}}\n\nExplanation:\nYour subscription allows {{left.lesson}} classes per month,\nbut you requested {{day.count}} classes.\n\nTherefore, we had to limit some bookings.\n\nOptions:\n1️⃣ Adjust your schedule to match your subscription\n2️⃣ Upgrade your plan by contacting us\n\nPlease check your updated schedule in the app.\nWe're here if you need any help 🤗\n\nTulkka Team 📚"
            },
            HE: {
                title: 'כמות שיעורים עודפת החודש 😅',
                content: "{{student.name}} 👋 היי\n\nשמחים ללוות אותך בחודש נוסף של למידה מגניבה ב-Tulkka! 📚\nהשיעורים שלך נקבעו בימים:\n\n{{time.day}}\n\nחשוב לציין 💡\nבתאריכים הבאים לא נקבעו שיעורים עקב חריגה:\n{{message}}\n\nהסבר:\nהמנוי שלך מאפשר עד {{left.lesson}} שיעורים,\nאך ביקשת {{day.count}} שיעורים.\n\nלכן לא ניתן היה לקבוע את כל השיעורים המבוקשים.\n\nהאפשרויות שלך:\n1️⃣ להתאים את לוח השיעורים לפי המנוי\n2️⃣ לשדרג את המנוי בתיאום מולנו\n\nאנא בדוק את לוח השיעורים המעודכן באפליקציה.\nנשמח לעזור בכל שאלה 🤗\n\nצוות Tulkka 📚"
            }
        },
        regular_class_reminders_for_teacher_4: {
            EN: {
                title: 'Class Reminder - 4 Hours',
                content: "Hello {{instructor.name}} 👋🏼,\n\nThis is a reminder that you have a class with {{student.name}} in 4 hours at {{time.date}}.\n\nClass duration: {{time.duration}} minutes\n\nPlease make sure you're prepared for the lesson.\n\nBest regards,\nThe Tulkka Team 📚"
            },
            HE: {
                title: 'תזכורת לשיעור - 4 שעות',
                content: "שלום {{instructor.name}} 👋🏼,\n\nזו תזכורת שיש לך שיעור עם {{student.name}} בעוד 4 שעות בשעה {{time.date}}.\n\nמשך השיעור: {{time.duration}} דקות\n\nאנא וודא שאתה מוכן לשיעור.\n\nבברכה,\nצוות Tulkka 📚"
            }
        },
        regular_class_reminders_teacher_1: {
            EN: {
                title: 'Class Starting in 1 Hour',
                content: "Hello {{instructor.name}} 👋🏼,\n\nYour class with {{student.name}} starts in 1 hour!\n\nClass duration: {{time.duration}} minutes\n\nPlease prepare to join the lesson on time.\n\nBest regards,\nThe Tulkka Team 📚"
            },
            HE: {
                title: 'השיעור מתחיל בעוד שעה',
                content: "שלום {{instructor.name}} 👋🏼,\n\nהשיעור שלך עם {{student.name}} מתחיל בעוד שעה!\n\nמשך השיעור: {{time.duration}} דקות\n\nאנא היכון להצטרף לשיעור בזמן.\n\nבברכה,\nצוות Tulkka 📚"
            }
        },
        regular_class_reminders_30: {
            EN: {
                title: 'Class Starting in 30 Minutes',
                content: "Hey {{student.name}} 👋,\n\nYour Tulkka lesson starts in half an hour! ⏰\n\nWe recommend preparing and logging in on time.\nHere are your lesson connection details:\n\n📌 Lesson link:\n\n{{link.link}}\n\n🔑 Meeting ID: {{meeting.id}}\n🔒 Passcode: {{access.code}}\n\nWe're looking forward to seeing you soon! 😊"
            },
            HE: {
                title: 'השיעור מתחיל בעוד 30 דקות',
                content: "היי {{student.name}} 👋,\n\nעוד חצי שעה השיעור שלך Tulkka מתחיל! ⏰\n\nאנחנו ממליצים להתכונן ולהתחבר בזמן.\n\nפרטי ההתחברות לשיעור:\n\n📌 קישור לשיעור:\n\n{{link.link}}\n\n🔑 מזהה פגישה: {{meeting.id}}\n🔒 קוד גישה: {{access.code}}\n\nאנחנו מצפים לראות אותך בקרוב! 😊"
            }
        },
        regular_class_cancelled: {
            EN: {
                title: 'Regular Class Canceled',
                content: "Hello {{instructor.name}},\n\n❌ The student {{student.name}} has canceled their regular class scheduled for:\n\n📅 Date: {{class.date}}\n⏰ Time: {{class.time}}\n\nIf you have any questions, please reach out to your manager. 💬"
            },
            HE: {
                title: 'שיעור קבוע בוטל',
                content: "שלום {{instructor.name}},\n\n❌ התלמיד {{student.name}} ביטל את השיעור הקבוע שנקבע ל:\n\n📅 תאריך: {{class.date}}\n⏰ שעה: {{class.time}}\n\nבמידה ויש שאלות, ניתן לפנות למנהל שלך. 💬"
            }
        },
        recurring_payment: {
            EN: {
                title: 'Your Recurring Payment Link - Tulkka',
                content: "Hello {{student.name}} 👋🏼,\n\nWe're excited to help you continue your learning journey with Tulkka!\n\n💰 Package: {{package.name}}\n\n🔗 Complete your recurring payment setup here:\n{{payment.link}}\n\nThis will set up automatic monthly payments for your learning package. You can cancel at any time through your account settings.\n\nThe payment will be automatically charged each month:\n- First payment will be processed immediately\n- Subsequent payments will be charged monthly\n- You'll receive confirmation for each payment\n\nIf you have any questions, feel free to contact us.\n\nWe look forward to welcoming you to the Tulkka family!\nThe Tulkka Team 📚"
            },
            HE: {
                title: 'קישור התשלום החוזר שלך - טולקה',
                content: "היי {{student.name}} 👋🏼,\n\nאני עוזר את בקשת התשלום עבור החבילה ללימודים בטולקה.\n\n💰 חבילה: {{package.name}}\n\n🔗 להשלמת התשלום:\n{{payment.link}}\n\nיש לשלם זה שוב תוקף לכמה ימים בלבד.\n\nהתשלומים יחויבו אוטומטית כל חודש, ניתן לבטל את החודש בכל עת:\n- התשלום הראשון יעובד מיד\n- התשלומים הבאים יחויבו חודשית\n- תקבל אישור לכל תשלום\n\nתודה שבחרת ב-Tulkka 💪🏼\nצוות Tulkka 📚"
            }
        },
        payment_refund_notification: {
            EN: {
                title: 'Refund Processed - Tulkka',
                content: "Hello {{student.name}},\n\nYour refund has been processed successfully.\n\n💰 Refund Details:\n• Type: {{refund.type}}\n• Amount: {{amount}} {{currency}}\n• Original Payment: {{original.amount}} {{currency}}\n• Transaction ID: {{transaction.id}}\n• Date: {{refund.date}}\n\n📋 Reason: {{refund.reason}}\n\nYour refund will appear in your original payment method within 3-7 business days.\n\nIf you have any questions about this refund, please contact our support team at {{support.email}}.\n\nBest regards,\nThe Tulkka Team"
            },
            HE: {
                title: 'זיכוי עובד - טולקה',
                content: "שלום {{student.name}},\n\nהזיכוי שלך עובד בהצלחה.\n\n💰 פרטי הזיכוי:\n• סוג: {{refund.type}}\n• סכום: {{amount}} {{currency}}\n• תשלום מקורי: {{original.amount}} {{currency}}\n• מזהה עסקה: {{transaction.id}}\n• תאריך: {{refund.date}}\n\n📋 סיבה: {{refund.reason}}\n\nהזיכוי יופיע באמצעי התשלום המקורי תוך 3-7 ימי עסקים.\n\nאם יש לך שאלות כלשהן לגבי זיכוי זה, אנא פנה לצוות התמיכה שלנו ב-{{support.email}}.\n\nבברכה,\nצוות טולקה"
            }
        },
        payment_recovery: {
            EN: {
                title: 'Payment Recovery Link',
                content: "Hi {{student.name}},\n\nYour payment link:\n{{payment.link}}\n\nAmount: {{amount}} {{currency}}\n\nThank you,\nTulkka Team"
            },
            HE: {
                title: 'קישור לתשלום',
                content: "היי {{student.name}},\n\nהקישור לתשלום שלך:\n{{payment.link}}\n\nסכום: {{amount}} {{currency}}\n\nתודה,\nצוות Tulkka"
            }
        },
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
        if (!NotificationTemplates.notificationTemplates[key] || !NotificationTemplates.notificationTemplates[key][language]) {
            return null;
        }
        const notificationTemplate = NotificationTemplates.notificationTemplates[key][language];
        const notification = NotificationTemplates.toData(notificationTemplate, values, useCase);
        return notification;
    }
}

module.exports = NotificationTemplates;