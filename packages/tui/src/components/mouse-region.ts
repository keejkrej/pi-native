import {
	Component,
	type ComponentLike,
	dispatchMouseEvent,
	toComponent,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "../tui.ts";

export type MouseRegionHandler = (event: TuiMouseEvent) => TuiMouseEventResult | undefined;

/** Adds mouse handling to an existing component without changing its rendering. */
export class MouseRegion extends Component {
	private readonly child: Component;
	private readonly onMouse: MouseRegionHandler;

	constructor(child: Component | ComponentLike, onMouse: MouseRegionHandler) {
		super();
		this.child = toComponent(child);
		this.onMouse = onMouse;
	}

	override render(width: number): string[] {
		return this.child.render(width);
	}

	override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const childResult = dispatchMouseEvent(this.child, event);
		if (childResult) return childResult;
		return this.onMouse(event);
	}

	override invalidate(): void {
		this.child.invalidate();
	}
}
