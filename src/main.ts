import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import Home from './pages/Home.vue'
import Admin from './pages/Admin.vue'
import './style.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/admin', component: Admin },
    { path: '/archive', redirect: (to) => ({ path: '/', query: to.query }) },
    { path: '/about', redirect: '/' },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ],
  scrollBehavior: (to, from, saved) => {
    if (saved) return saved
    if (to.path === from.path) return false
    return { top: 0 }
  }
})

createApp(App).use(router).mount('#app')
