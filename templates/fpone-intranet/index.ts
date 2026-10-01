import { Output, randomPassword, randomString, Services } from "~templates-utils";
import { Input } from "./meta";

export function generate(input: Input): Output {
  const services: Services = [];
  const databasePassword = randomPassword();
  const garageRpcSecret = randomString(64); // hex-like, 64 chars
  const garageAdminToken = randomString(32);
  const authSecret = randomString(32);
  const cpfPepper = randomString(32);

  // Garage.toml inline gerado como config file — sem container init temporário.
  const garageToml = [
    `metadata_dir = "/var/lib/garage/meta"`,
    `data_dir = "/var/lib/garage/data"`,
    `db_engine = "sqlite"`,
    `replication_factor = 1`,
    ``,
    `[rpc]`,
    `bind_addr = "[::]:3901"`,
    `rpc_secret = "${garageRpcSecret}"`,
    ``,
    `[s3_api]`,
    `s3_region = "garage"`,
    `api_bind_addr = "[::]:3900"`,
    `root_domain = ".s3.local"`,
    ``,
    `[s3_web]`,
    `bind_addr = "[::]:3902"`,
    `root_domain = ".web.local"`,
    ``,
    `[admin]`,
    `api_bind_addr = "[::]:3903"`,
    `admin_token = "${garageAdminToken}"`,
  ].join("\n");

  // 1. Banco de Dados PostgreSQL 16
  services.push({
    type: "postgres",
    data: {
      serviceName: input.databaseServiceName,
      image: "postgres:16-alpine",
      password: databasePassword,
    },
  });

  // 2. Armazenamento S3 — Garage (substituto do MinIO)
  // Não requer container init separado; bootstrap é feito via CLI após o primeiro deploy.
  // Instruções de bootstrap incluídas nas notas do template.
  services.push({
    type: "app",
    data: {
      serviceName: `${input.appServiceName}-garage`,
      env: [
        `GARAGE_RPC_SECRET=${garageRpcSecret}`,
        `GARAGE_ADMIN_TOKEN=${garageAdminToken}`,
      ].join("\n"),
      source: {
        type: "image",
        image: "dxflrs/garage:v1.0.1",
      },
      mounts: [
        {
          type: "volume",
          name: "meta",
          mountPath: "/var/lib/garage/meta",
        },
        {
          type: "volume",
          name: "data",
          mountPath: "/var/lib/garage/data",
        },
      ],
      deploy: {
        command: `/garage -c /etc/garage.toml server`,
        configFiles: [
          {
            mountPath: "/etc/garage.toml",
            content: garageToml,
          },
        ],
      },
    },
  });

  // 3. Aplicação FPOne Intranet (Next.js 16 Standalone)
  // S3_ACCESS_KEY e S3_SECRET_KEY são preenchidos manualmente após o bootstrap do Garage.
  services.push({
    type: "app",
    data: {
      serviceName: input.appServiceName,
      source: {
        type: "image",
        image: input.appServiceImage,
      },
      domains: [
        {
          host: "$(EASYPANEL_DOMAIN)",
          port: 3000,
        },
      ],
      env: [
        // Banco de Dados
        `DATABASE_URL=postgresql://postgres:${databasePassword}@$(PROJECT_NAME)_${input.databaseServiceName}:5432/$(PROJECT_NAME)`,

        // Garage / S3
        `GARAGE_ENDPOINT=http://$(PROJECT_NAME)_${input.appServiceName}-garage:3900`,
        // Alias de compatibilidade — remove após atualização da imagem com GARAGE_ENDPOINT
        `MINIO_ENDPOINT=http://$(PROJECT_NAME)_${input.appServiceName}-garage:3900`,
        `S3_BUCKET=${input.s3Bucket}`,
        // Preenchidos manualmente após bootstrap do Garage (ver instruções do template)
        `S3_ACCESS_KEY=${input.s3AccessKey || "PREENCHER_APOS_BOOTSTRAP"}`,
        `S3_SECRET_KEY=${input.s3SecretKey || "PREENCHER_APOS_BOOTSTRAP"}`,
        `S3_PUBLIC_URL=https://$(PRIMARY_DOMAIN)`,

        // Autenticação & Sessão
        `AUTH_SECRET=${authSecret}`,
        `AUTH_URL=https://$(PRIMARY_DOMAIN)`,
        `AUTH_TRUST_HOST=true`,
        `AUTH_SESSION_HOURS=8`,
        `TRUST_PROXY=true`,
        `CPF_PEPPER=${cpfPepper}`,
        `TZ=America/Bahia`,

        // Active Directory / LDAP (Padrão Fazenda Progresso / GLPI)
        `AD_ENABLED=true`,
        `AD_HOST=${input.adHost}`,
        `AD_PORT=${input.adPort}`,
        `AD_URL=ldap://${input.adHost}:${input.adPort}`,
        `AD_BASE_DN=${input.adBaseDn}`,
        `AD_BIND_DN=${input.adBindDn}`,
        `AD_BIND_PASSWORD=${input.adBindPassword}`,
        `AD_LOGIN_ATTRIBUTE=sAMAccountName`,
        `AD_USER_FILTER=(&(objectClass=user)(objectCategory=person)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))`,
        `AD_CONNECT_TIMEOUT=5000`,
        `AD_OPERATION_TIMEOUT=10000`,
        `AD_USE_TLS=${input.adUseTls ? "true" : "false"}`,

        // Fallback Legado LDAP_*
        `LDAP_HOST=${input.adHost}`,
        `LDAP_PORT=${input.adPort}`,
        `LDAP_SECURITY=${input.adUseTls ? "ldaps" : "none"}`,
        `LDAP_BASE_DN=${input.adBaseDn}`,
        `LDAP_BIND_DN=${input.adBindDn}`,
        `LDAP_BIND_PASSWORD=${input.adBindPassword}`,
        `LDAP_LOGIN_ATTRIBUTE=sAMAccountName`,
        `LDAP_USER_FILTER=(&(objectClass=user)(objectCategory=person)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))`,
        `LDAP_TIMEOUT_MS=5000`,
        `LDAP_CONNECT_TIMEOUT_MS=5000`,
        `LDAP_TLS_REJECT_UNAUTHORIZED=true`,

        // Proteção e Políticas
        `LOGIN_MAX_FAILS_PER_USER=5`,
        `LOGIN_MAX_FAILS_PER_IP=20`,
        `LOGIN_RATE_WINDOW_MINUTES=15`,
        `AUDIT_RETENTION_MONTHS=24`,
        `DEMO_MODE=false`,
        `FEATURE_AI_SEARCH=false`,

        // Identidade Visual e Suporte
        `NEXT_PUBLIC_COMPANY_NAME=${input.companyName || "Fazenda Progresso"}`,
        `NEXT_PUBLIC_APP_ENV=production`,
        `GLPI_TICKET_URL=${input.glpiTicketUrl || ""}`,
      ].join("\n"),
    },
  });

  return { services };
}
