-- Radar Ofertas — schema MySQL 8+ (utf8mb4)
-- Banco Dokploy: ml-db-link-banco (usuário mix-s-db-link02)
--
-- Importe pelo painel (SQL) ou CLI:
--   mysql -h HOST -P 3360 -u mix-s-db-link02 -p ml-db-link-banco < backend/prisma/mysql/import.sql
--
-- No Dokploy o banco já existe — não rode CREATE DATABASE abaixo.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- CREATE DATABASE IF NOT EXISTS `ml-db-link-banco`
--   CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE `ml-db-link-banco`;

-- ---------------------------------------------------------------------------
-- Tabelas de aplicação (espelham backend/prisma/schema.prisma)
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

-- Histórico do Prisma Migrate (baseline MySQL)
CREATE TABLE IF NOT EXISTS `_prisma_migrations` (
  `id` VARCHAR(36) NOT NULL,
  `checksum` VARCHAR(64) NOT NULL,
  `finished_at` DATETIME(3) NULL,
  `migration_name` VARCHAR(255) NOT NULL,
  `logs` TEXT NULL,
  `rolled_back_at` DATETIME(3) NULL,
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `applied_steps_count` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `_prisma_migrations` (
  `id`,
  `checksum`,
  `finished_at`,
  `migration_name`,
  `logs`,
  `rolled_back_at`,
  `started_at`,
  `applied_steps_count`
)
SELECT
  '00000000-0000-0000-0000-000000000001',
  '68be1a7003cf4d7c56f62d124205443c327cd2eca6b46a39f425898fb4968aae',
  CURRENT_TIMESTAMP(3),
  '20250627000000_init',
  NULL,
  NULL,
  CURRENT_TIMESTAMP(3),
  1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `_prisma_migrations` WHERE `migration_name` = '20250627000000_init'
);

SET FOREIGN_KEY_CHECKS = 1;
