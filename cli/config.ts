export type GoatAppConfig = {
  path: string;
  src?: string;
  html?: string;
  css?: string;
  assets?: string;
};

export type GoatConfig = {
  apps: GoatAppConfig[];
  schema: string | string[];
  operatorEmails?: string[];
};
