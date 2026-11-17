.PHONY: all pi examples coverage test clean

all:
	./build.sh all

pi:
	./build.sh pi

examples:
	./build.sh examples

coverage:
	./build.sh coverage

test:
	./build.sh test

clean:
	./build.sh clean
