import { defaultEventTypes, type Archive } from '../../src/lib/schema'

// Keep behavior tests independent of records and settings edited through the site.
export const archiveFixture: Archive = {
  version: 1,
  settings: {
    name: '余响',
    englishName: 'AFTERGLOW',
    owner: '测试观众',
    tagline: '记录现场',
    bio: '测试用观演档案',
    categories: [...defaultEventTypes]
  },
  records: [
    {
      id: 'test-concert',
      title: '交响音乐会',
      artist: '测试乐团',
      orchestra: '测试交响乐团',
      conductor: '测试指挥',
      soloists: ['测试独奏家'],
      date: '2025-06-21',
      city: '上海',
      venue: '测试音乐厅',
      seat: '1层 3排 8座',
      price: '¥680',
      status: 'watched',
      type: '音乐会',
      rating: 5,
      note: '中文观演记录',
      tags: ['交响乐'],
      program: [{ title: '测试序曲', composer: '测试作曲家', half: '上半场' }],
      images: ['photos/orchestra.jpg'],
      featured: true,
      published: true,
      demo: false
    },
    {
      id: 'test-livehouse',
      title: '小场地现场',
      artist: '测试乐队',
      orchestra: '',
      conductor: '',
      soloists: [],
      date: '2025-04-12',
      city: '南京',
      venue: '测试 Livehouse',
      seat: '',
      price: '',
      status: 'watched',
      type: 'Livehouse',
      rating: 4,
      note: '',
      tags: [],
      program: [],
      images: [],
      featured: false,
      published: true,
      demo: false
    }
  ]
}
