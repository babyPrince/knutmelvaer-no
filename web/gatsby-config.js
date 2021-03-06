// Load variables from `.env` as soon as possible
require('dotenv').config({
  path: `.env.${process.env.NODE_ENV || 'development'}`
})

const fetch = require('isomorphic-fetch')
const { createHttpLink } = require('apollo-link-http')
const PortableText = require('@sanity/block-content-to-html')
const imageUrlBuilder = require('@sanity/image-url')

const { isFuture, parseISO } = require('date-fns')
const clientConfig = require('./client-config')
const {
  getBlogUrl,
  filterOutDocsPublishedInTheFuture
} = require('./nodeHelpers.js')

const h = PortableText.h
const isProd = process.env.NODE_ENV === 'production'
const imageUrlFor = source => imageUrlBuilder(clientConfig.sanity).image(source)

module.exports = {
  siteMetadata: {
    title: 'Knut Melvær',
    siteUrl: 'https://www.knutmelvaer.no',
    description: 'The blog and website of Knut Melvær'
  },
  plugins: [
    'gatsby-plugin-postcss',
    'gatsby-plugin-react-helmet',
    {
      resolve: 'gatsby-plugin-fathom',
      options: {
        // Fathom server URL. Defaults to `cdn.usefathom.com`
        trackingUrl: 'stats.knutmelvaer.no',
        // Unique site id
        siteId: process.env.FATHOM_KEY
      }
    },
    {
      resolve: 'gatsby-source-graphql',
      options: {
        // This type will contain remote schema Query type
        typeName: 'FATHOM',
        // This is the field under which it's accessible
        fieldName: 'fathom',
        // URL to query from
        createLink: () =>
          createHttpLink({
            uri: 'https://graphql.knutmelvaer.no/v1/graphql', // <- Configure connection GraphQL url
            headers: {
              'x-hasura-admin-secret': process.env.HASURA_ADMIN_SECRET
            },
            fetch
          }),
        refetchInterval: 10 // Refresh every 10 seconds for new data
      }
    },
    {
      resolve: `gatsby-transform-portable-text`,
      options: {
        extendTypes: [{ typeName: `SanityPost`, contentFieldName: "body" }]
      }
    },
    {
      resolve: 'gatsby-plugin-sitemap',
      options: {
        query: `
        {
          site {
            siteMetadata {
              siteUrl
            }
          }
          allSitePage(filter: {id:{ne: null}}) {
            edges {
              node {
                id
                path
                context {
                  id
                }
              }
            }
          }
          allSanityPost(filter: {id:{ne: null}}) {
            edges {
              node {
                id
                publishedAt
              }
            }
          }
      }`,
        serialize: ({ site, allSitePage, allSanityPost }) => {
          // make a list of future posts
          const futurePosts = [
            ...allSanityPost.edges.filter(({ node }) =>
              isFuture(parseISO(node.publishedAt))
            )
            // ...otherSanityType.edges.filter(({node})=> isFuture(node.publishedAt)),
          ]
          const pagesInFuture = ({ node }) =>
            futurePosts.find(({ node }) => node.id !== node.context.id)
          return allSitePage.edges.filter(pagesInFuture).map(edge => {
            return {
              url: site.siteMetadata.siteUrl + edge.node.path,
              changefreq: 'daily',
              priority: 0.7
            }
          })
        }
      }
    },
    {
      resolve: 'gatsby-source-sanity',
      options: {
        ...clientConfig.sanity,
        token: process.env.SANITY_READ_TOKEN,
        watchMode: !isProd,
        overlayDrafts: !isProd
      }
    },
    {
      resolve: 'gatsby-plugin-webmention',
      options: {
        username: 'www.knutmelvaer.no', // webmention.io username
        identity: {
          github: 'kmelve',
          twitter: 'kmelve' // no @
        },
        mentions: true,
        pingbacks: true,
        // forwardPingbacksAsWebmentions: 'https://www.knutmelvaer.no/endpoint',
        domain: 'www.knutmelvaer.no',
        token: process.env.WEBMENTIONS_TOKEN
      }
    },
    {
      resolve: 'gatsby-plugin-feed',
      options: {
        query: `
        {
          site {
            siteMetadata {
              title
              description
              siteUrl
              site_url: siteUrl
            }
          }
        }
        `,
        feeds: [
          {
            serialize: ({ query: { site, allSanityPost = [] } }) => {
              return allSanityPost.edges
                .filter(({ node }) => node.publishedAt)
                .filter(({ node }) => filterOutDocsPublishedInTheFuture(node))
                .filter(({ node }) => node.slug)
                .map(({ node }) => {
                  const { title, publishedAt, slug, _rawBody } = node
                  const url =
                    site.siteMetadata.siteUrl +
                    getBlogUrl(publishedAt, slug.current)
                  return {
                    title: title,
                    date: publishedAt,
                    url,
                    guid: url,
                    custom_elements: [
                      {
                        'content:encoded': {
                          _cdata: PortableText({
                            blocks: _rawBody,
                            serializers: {
                              marks: {
                                internalLink: ({ mark, children }) => {
                                  const {
                                    publishedAt,
                                    slug,
                                    _type
                                  } = mark.reference
                                  if (_type == 'post') {
                                    const path = getBlogUrl(publishedAt, slug)
                                    return h(
                                      'a',
                                      {
                                        href: `https://www.knutmelvaer.no/${
                                          path
                                        }`
                                      },
                                      children
                                    )
                                  }
                                  console.log(
                                    'Unknown internal link type ',
                                    mark.reference
                                  )
                                  return h('span', {}, children)
                                }
                              },
                              types: {
                                youtube: ({ node}) =>
                                h(
                                  'p',
                                  {},
                                  h('a', {
                                    href: node.url,
                                    innerHTML: 'Watch on Youtube.'
                                  })
                                ),
                                code: ({ node }) =>
                                  h(
                                    'pre',
                                    h(
                                      'code',
                                      { lang: node.language },
                                      node.code
                                    )
                                  ),
                                mainImage: ({ node }) =>
                                  h('img', {
                                    src: imageUrlFor(node.asset).url()
                                  }),
                                twitter: ({ node }) =>
                                  h(
                                    'p',
                                    {},
                                    h('a', {
                                      href: node.url,
                                      innerHTML: 'Look at the tweet.'
                                    })
                                  )
                              }
                            }
                          })
                        }
                      }
                    ]
                  }
                })
            },
            query: `{
              allSanityPost(sort: {fields: publishedAt, order: DESC}) {
                edges {
                  node {
                    _rawExcerpt
                    _rawBody(resolveReferences: {maxDepth: 10})
                    title
                    publishedAt
                    slug {
                      current
                    }
                  }
                }
              }
            }
            `,
            output: '/rss.xml',
            title: 'Knut Melvær'
            // optional configuration to insert feed reference in pages:
            // if `string` is used, it will be used to create RegExp and then test if pathname of
            // current page satisfied this regular expression;
            // if not provided or `undefined`, all pages will have feed reference inserted
          }
        ]
      }
    }
  ]
}
