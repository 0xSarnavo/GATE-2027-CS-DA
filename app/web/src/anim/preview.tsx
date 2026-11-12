// Temporary dev preview: bunx vite web --open /src/anim/preview.html   (run from app/)
import { render } from 'preact'
import '../styles.css'
import { AnimGallery } from './index'
render(<AnimGallery />, document.getElementById('app')!)
