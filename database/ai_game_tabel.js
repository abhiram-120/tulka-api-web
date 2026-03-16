
//GAME OPTIONS TABLE
CREATE TABLE `game_options` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `game_type` ENUM('flashcards','spelling_bee','grammar_challenge','advanced_cloze','sentence_builder') NOT NULL,
  `option_key` VARCHAR(50) NOT NULL COMMENT 'by_topic, by_lesson, custom_words, mistakes_only, direct',
  `option_label` VARCHAR(100) NOT NULL COMMENT 'Display name: By Topic, By Lesson, etc.',
  `option_description` TEXT DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `icon_url` VARCHAR(255) DEFAULT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_game_type` (`game_type`),
  KEY `idx_is_active` (`is_active`),
  KEY `idx_game_type_active` (`game_type`,`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;



//GAME OPTION ITEMS TABLE
CREATE TABLE `game_option_items` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `game_option_id` INT NOT NULL,
  `option_item` JSON NOT NULL COMMENT 'Stores object like { "key": "hobbies", "value": "Hobbies & Interests" }',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_game_option_id` (`game_option_id`),
  CONSTRAINT `fk_game_option_items_option`
    FOREIGN KEY (`game_option_id`) REFERENCES `game_options` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;




//GAME SESSIONS - ADD COLUMN
ALTER TABLE `game_sessions`
ADD COLUMN `selected_item_id` INT NULL;




//GAMES - ADD COLUMN FIRST (IMPORTANT)
ALTER TABLE `games`
ADD COLUMN `game_option_item_id` INT NULL
COMMENT 'Links to game_option_items table';




//GAMES - ADD INDEX
CREATE INDEX `idx_game_option_item_id`
ON `games` (`game_option_item_id`);




//GAMES - ADD FOREIGN KEY
ALTER TABLE `games`
ADD CONSTRAINT `fk_games_game_option_item_id`
FOREIGN KEY (`game_option_item_id`)
REFERENCES `game_option_items`(`id`)
ON DELETE SET NULL
ON UPDATE CASCADE;

//adding new column
ALTER TABLE games
ADD COLUMN exercise_explanation TEXT NULL
AFTER explanation;


UPDATE games
SET exercise_explanation = CASE exercise_type
    WHEN 'flashcard' THEN 'Study vocabulary with interactive flashcards'
    WHEN 'spelling_bee' THEN 'Hear the word and type the correct spelling'
    WHEN 'sentence_builder' THEN 'Arrange the words to build a correct English sentence'
    WHEN 'grammar_challenge' THEN 'Advanced multiple-choice grammar with explanations'
    WHEN 'advanced_cloze' THEN 'Context-gap fill with phrasal verbs and collocations'
    WHEN 'fill_blank' THEN 'Complete sentences using the correct grammar'
    ELSE exercise_explanation
END;
