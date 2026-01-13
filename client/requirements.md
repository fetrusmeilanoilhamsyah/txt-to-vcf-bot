## Packages
framer-motion | Smooth animations for drag-and-drop and transitions
clsx | Utility for constructing className strings conditionally
tailwind-merge | Utility for merging Tailwind classes safely

## Notes
The application communicates with /api/convert via FormData.
The backend expects 'file', 'contactName', 'fileName', and 'splitLimit'.
The response from /api/convert is a blob (zip file or vcf file), not JSON.
