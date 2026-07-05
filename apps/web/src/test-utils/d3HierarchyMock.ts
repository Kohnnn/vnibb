const chainable = () => {
    const node = {
        sum: () => node,
        sort: () => node,
        leaves: () => [],
        x0: 0,
        y0: 0,
        x1: 0,
        y1: 0,
    };
    return node;
};

export const hierarchy = () => chainable();

export const treemap = () => {
    const layout = (root: unknown) => root;
    layout.size = () => layout;
    layout.padding = () => layout;
    layout.paddingInner = () => layout;
    layout.paddingOuter = () => layout;
    layout.round = () => layout;
    return layout;
};
