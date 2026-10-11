import { parseColor, type RGBA } from "./visual";

export type BackgroundResult = 
    | { kind: 'color'; color: RGBA} // a solid color we can work out
    | { kind: 'image'; element: Element}; // an image/gradient that needs canvas sampling

// Blend a (possibly translucent) top color over an opaque bottom color.
export function compositeOver(top: RGBA, bottom: RGBA): RGBA {
    const a = top.a;
    return {
        r: top.r * a + bottom.r * (1-a),
        g: top.g * a + bottom.g * (1-a),
        b: top.b * a + bottom.b * (1-a),
        a: 1,
    };
}

const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1};

// Walk up from the elements parent to work out what color sits behind it
export function findEffectiveBackground(el: Element): BackgroundResult {
    const layers: RGBA[] = [] //nearest layer first
    let node: Element | null = el.parentElement;

    while (node) {
        const style = getComputedStyle(node);

        const image = style.backgroundImage;
        if (image && image !== 'none') {
            return { kind: 'image', element: node };
        }

        //parseColor return null for empty/unknown values; treat that as transparent
        const color = parseColor(style.backgroundColor);
        if (color && color.a > 0) {
            layers.push(color);
            if (color.a >=1) break; // fully opaque: nothing behind it matters
        }

        node = node.parentElement;
    }

    //Blend from the farthest layer to the nearest, starting from white
    let result = WHITE;
    for (let i = layers.length - 1; i >=0; i--) {
        result = compositeOver(layers[i], result);
    }
    return { kind: 'color', color: result };
}