import { createElement, type ReactNode } from 'react';

const ReactMarkdown = ({ children }: { children?: ReactNode }) =>
    createElement('div', { 'data-testid': 'react-markdown-stub' }, children);

export default ReactMarkdown;
