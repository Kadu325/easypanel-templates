import { Output, randomPassword, randomString, Services } from "~templates-utils";
import { Input } from "./meta";

export function generate(input: Input): Output {
  const services: Services = [];
  const databasePassword = randomPassword();
  const minioPassword = randomPassword();
  const authSecret = randomString(32);
  const cpfPepper = randomString(16);

  services.push({
    type: "postgres",
    data: {
      serviceName: input.databaseServiceName,
      password: databasePassword,
    },
  });

  services.push({
    type: "app",
    data: {
      serviceName: `${input.appServiceName}-minio`,
      env: [
        `MINIO_ROOT_USER=admin`,
        `MINIO_ROOT_PASSWORD=${minioPassword}`,
        `MINIO_BROWSER=off`,
      ].join("\n"),
      source: {
        type: "image",
        image: "minio/minio:latest",
      },
      mounts: [
        {
          type: "volume",
          name: "data",
          mountPath: "/data",
        },
      ],
      deploy: {
        command: "server /data",
      },
    },
  });

  services.push({
    type: "app",
    data: {
      serviceName: `${input.appServiceName}-minio-init`,
      env: [
        `MC_HOST_local=http://admin:${minioPassword}@$(PROJECT_NAME)_${input.appServiceName}-minio:9000`,
      ].join("\n"),
      source: {
        type: "image",
        image: "minio/mc:latest",
      },
      deploy: {
        command: `mb --ignore-existing local/${input.s3Bucket}`,
        restartPolicy: "none",
      },
    },
  });

  services.push({
    type: "app",
    data: {
      serviceName: input.appServiceName,
      env: [
        `DATABASE_URL=postgresql://postgres:${databasePassword}@$(PROJECT_NAME)_${input.databaseServiceName}:5432/$(PROJECT_NAME)`,
        `MINIO_ENDPOINT=http://$(PROJECT_NAME)_${input.appServiceName}-minio:9000`,
        `S3_BUCKET=${input.s3Bucket}`,
        `S3_ACCESS_KEY=admin`,
        `S3_SECRET_KEY=${minioPassword}`,
        `S3_PUBLIC_URL=https://${input.appDomain}`,
        `AUTH_SECRET=${authSecret}`,
        `AUTH_URL=https://${input.appDomain}`,
        `AUTH_TRUST_HOST=true`,
        `TRUST_PROXY=true`,
        `CPF_PEPPER=${cpfPepper}`,
        `TZ=America/Bahia`,
      ].join("\n"),
      source: {
        type: "image",
        image: input.appServiceImage,
      },
      domains: [
        {
          host: input.appDomain,
          port: 3000,
        },
      ],
    },
  });

  return { services };
}
