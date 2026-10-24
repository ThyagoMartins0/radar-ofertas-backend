-- Radar Ofertas — schema MySQL 8+ (utf8mb4)
--
-- Idempotente (CREATE TABLE IF NOT EXISTS): rodado por `npm run migrate:deploy`
-- (serviço migrate do docker compose) ou importado à mão no painel do banco:
--   mysql -h HOST -P PORTA -u USUARIO -p BANCO < src/database/schema.sql

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- Tabelas de aplicação
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `settings` (
  `key` VARCHAR(191) NOT NULL,
  `value` TEXT NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `offers` (
  `id` VARCHAR(191) NOT NULL,
  `mercado_livre_id` VARCHAR(191) NOT NULL,
  `title` TEXT NOT NULL,
  `price` DECIMAL(12, 2) NOT NULL,
  `old_price` DECIMAL(12, 2) NULL,
  `discount` INT NULL,
  `image` TEXT NULL,
  `permalink` TEXT NULL,
  `affiliate_link` TEXT NULL,
  `rating` DOUBLE NULL,
  `sold_quantity` INT NULL,
  `sales_rank` VARCHAR(191) NULL,
  `seller` VARCHAR(191) NULL,
  `official_store` BOOLEAN NOT NULL DEFAULT false,
  `best_seller` BOOLEAN NOT NULL DEFAULT false,
  `score` INT NOT NULL DEFAULT 0,
  `sent_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `offers_mercado_livre_id_key` (`mercado_livre_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `offer_deliveries` (
  `id` VARCHAR(191) NOT NULL,
  `offer_id` VARCHAR(191) NOT NULL,
  `channel` VARCHAR(191) NOT NULL,
  `account_id` VARCHAR(191) NOT NULL DEFAULT 'default',
  `sent_at` DATETIME(3) NULL,
  `message_id` VARCHAR(191) NULL,
  `error` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `offer_deliveries_offer_id_channel_account_id_key` (`offer_id`, `channel`, `account_id`),
  KEY `offer_deliveries_channel_sent_at_idx` (`channel`, `sent_at`),
  KEY `offer_deliveries_account_id_channel_sent_at_idx` (`account_id`, `channel`, `sent_at`),
  CONSTRAINT `offer_deliveries_offer_id_fkey`
    FOREIGN KEY (`offer_id`) REFERENCES `offers` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auto_messages` (
  `id` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `content` TEXT NOT NULL,
  `schedule_type` VARCHAR(191) NOT NULL DEFAULT 'manual',
  `scheduled_at` DATETIME(3) NULL,
  `daily_hour` INT NULL,
  `daily_minute` INT NULL DEFAULT 0,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `last_sent_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `accounts` (
  `id` VARCHAR(191) NOT NULL,
  `platform` VARCHAR(191) NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `config` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`, `platform`),
  KEY `accounts_platform_enabled_idx` (`platform`, `enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(191) NOT NULL,
  `username` VARCHAR(191) NOT NULL,
  `password_hash` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_username_key` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sessão de afiliado Mercado Livre (storageState do Playwright) — chave = authPath da conta
CREATE TABLE IF NOT EXISTS `ml_sessions` (
  `auth_path` VARCHAR(191) NOT NULL,
  `storage_state` JSON NULL,
  `last_login_at` DATETIME(3) NULL,
  `last_refresh_at` DATETIME(3) NULL,
  `last_error` TEXT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`auth_path`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
