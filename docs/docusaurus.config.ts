import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'GoatDB',
  tagline:
    'Embedded database with real-time sync and automatic conflict resolution',
  favicon: 'img/favicon.png',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://goatdb.dev',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'goatplatform', // Usually your GitHub org/user name.
  projectName: 'goatdb', // Usually your repo name.

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  plugins: [
    [
      '@docusaurus/plugin-google-gtag',
      {
        trackingID: 'G-27ES13ZKRG',
        anonymizeIP: true,
      },
    ],
    // Disable webpack-dev-server compression to fix ERR_CONTENT_DECODING_FAILED
    function customWebpackPlugin() {
      return {
        name: 'custom-webpack-plugin',
        configureWebpack(config, isServer) {
          if (!isServer) {
            return {
              devServer: {
                compress: false,
              },
            };
          }
          return {};
        },
      };
    },
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: 'docs', // Normal docs path
          sidebarPath: './sidebars.ts',
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl: 'https://github.com/goatplatform/goatdb/tree/main/docs/',
          remarkPlugins: [remarkMath],
          rehypePlugins: [rehypeKatex],
        },
        blog: false, // Disable the blog
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: 'img/goatdb_logo_dark_500.png',
    navbar: {
      title: 'GoatDB',
      logo: {
        alt: 'GoatDB Logo',
        src: 'img/goatdb_logo_dark_500.png',
        srcDark: 'img/goatdb_logo_light_500.png',
      },
      items: [
        {
          type: 'doc',
          docId: 'installation',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/docs/api',
          position: 'left',
          label: 'API',
        },
        {
          href: 'https://discord.gg/SAt3cbUqxr',
          label: 'Discord',
          position: 'right',
        },
        {
          href: 'https://www.reddit.com/r/zbdb/s/jx1jAbEqtj',
          label: 'Reddit',
          position: 'right',
        },
        {
          href: 'https://github.com/goatplatform/goatdb',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/tutorial',
            },
            {
              label: 'Architecture',
              to: '/docs/architecture',
            },
            {
              label: 'API Reference',
              to: '/docs/api',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'Discord',
              href: 'https://discord.gg/SAt3cbUqxr',
            },
            {
              label: 'Reddit',
              href: 'https://www.reddit.com/r/zbdb/s/jx1jAbEqtj',
            },
            {
              label: 'GitHub Discussions',
              href: 'https://github.com/goatplatform/goatdb/discussions',
            },
          ],
        },
        {
          title: 'Resources',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/goatplatform/goatdb',
            },
            {
              label: 'Benchmarks',
              to: '/docs/benchmarks',
            },
            {
              label: 'FAQ',
              to: '/docs/faq',
            },
          ],
        },
      ],
      copyright: `Copyright © ${
        new Date().getFullYear()
      } GoatDB · Apache 2.0 License`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['typescript', 'javascript'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
